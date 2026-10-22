'use strict';

/**
 * src/sertifika-yoneticisi.js (o-56): HA ana bilgisayarına özel kök CA / parmak izi sabitleme kararları, oturum kancası, canlı bağlantı
 * seçenekleri ve Ayarlar işleyicileri. Gerçek ağ ve Electron yok: oturum sahte, sertifikalar bellekte üretilir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sertifikaDeposuOlustur } = require('../src/lib/sertifika-deposu');
const { sertifikaYoneticisiOlustur } = require('../src/sertifika-yoneticisi');
const { kokBilgisi, sertifikaParmagi } = require('../src/lib/sertifika');
const { sertifikaUret, zincirUret } = require('./sertifika-uret');

const GUN = 86400000;
const AYAR = { yerelAdres: 'https://192.168.1.50:8123', disAdres: 'https://ha.example.com' };
const YETKILI_GECERSIZ = 'net::ERR_CERT_AUTHORITY_INVALID';

function ortamKur({ ayar = AYAR, dosyaSec = async () => null, sertifikaOkuyucu, onceden = null, gecikmeli = false } = {}) {
  const klasor = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-paneli-sertyon-'));
  const dosyaYolu = path.join(klasor, 'sertifika-guveni.json');
  if (onceden) fs.writeFileSync(dosyaYolu, JSON.stringify(onceden), 'utf8');
  const gunluk = [];
  const gercekDepo = sertifikaDeposuOlustur({ dosyaYolu, fs, gunluk: (m) => gunluk.push(m) });
  let depo = gercekDepo;
  let yuklemeyiBitir = async () => {};
  if (gecikmeli) {
    // Gerçek depo kayıtları eşzamanlı yükler (hazirMi() ilk hazir() çağrısında true olur); yönetici ise eşzamansız bir depoya da dayanıklı olmalı.
    // Bu sarmalayıcı yüklemeyi `yuklemeyiBitir()` çağrılana dek bekletir: o ana kadar hazirMi() false, hazir() bekler, kayıtlar boştur.
    let hazirBayrak = false;
    let coz;
    let reddet;
    const sozu = new Promise((c, r) => {
      coz = c;
      reddet = r;
    });
    depo = { ...gercekDepo, hazirMi: () => hazirBayrak, hazir: () => sozu };
    yuklemeyiBitir = async ({ hata = false } = {}) => {
      if (hata) {
        reddet(new Error('okunamadi'));
        return;
      }
      await gercekDepo.yukle();
      hazirBayrak = true;
      coz();
    };
  }
  let guncelAyar = ayar;
  const yonetici = sertifikaYoneticisiOlustur({ depo, ayarlarAl: () => guncelAyar, dosyaSec, sertifikaOkuyucu, gunluk: (m) => gunluk.push(m) });
  return {
    klasor,
    depo,
    yonetici,
    yuklemeyiBitir,
    gunluk,
    ayarDegistir: (yeni) => {
      guncelAyar = yeni;
    },
    temizle: () => fs.rmSync(klasor, { recursive: true, force: true }),
  };
}

const istek = (hostname, sertifika, verificationResult = YETKILI_GECERSIZ, zincir = []) => {
  // Electron Certificate: data (PEM) + issuerCert (iç içe zincir)
  let issuerCert;
  for (const pem of [...zincir].reverse()) issuerCert = { data: pem, issuerCert };
  return { hostname, certificate: { data: sertifika.pem, issuerCert }, verificationResult };
};

function sahteOturum() {
  const o = {
    proc: undefined,
    cagrilar: [],
    kapatma: 0,
    setCertificateVerifyProc(f) {
      o.proc = f;
      o.cagrilar.push(f === null ? 'null' : 'islev');
    },
    async closeAllConnections() {
      o.kapatma += 1;
    },
  };
  return o;
}
const procCalistir = (oturum, i) => new Promise((coz) => oturum.proc(i, coz));

test('karar: HA dışı ana bilgisayarda her zaman -3 (Chromium sonucu); kayıt olsa da http adreste ve kayıtsız adreste devreye girmez', async () => {
  const { ca, sunucu } = zincirUret({ sunucuAdi: 'baska.example.net', san: ['baska.example.net'] });
  const o = ortamKur({ ayar: { yerelAdres: 'http://192.168.1.50:8123', disAdres: 'https://ha.example.com' } });
  try {
    await o.yonetici.yukle();
    await o.depo.kokEkle([kokBilgisi(ca.pem)]);
    await o.depo.sabitle('baska.example.net', 'ab'.repeat(32));
    assert.equal(o.yonetici.karar(istek('baska.example.net', sunucu)), -3, 'ayarda olmayan ana bilgisayar');
    assert.equal(o.yonetici.karar(istek('192.168.1.50', sunucu)), -3, 'http adres TLS kullanmaz');
    assert.equal(o.yonetici.karar({ hostname: '', certificate: { data: sunucu.pem } }), -3);
    assert.equal(o.yonetici.karar({}), -3);
    assert.equal(o.yonetici.karar(null), -3);
  } finally {
    o.temizle();
  }
});

test('karar: kayıt yoksa HA ana bilgisayarında da -3 (bugünkü davranış)', async () => {
  const { sunucu } = zincirUret({ sunucuAdi: 'ha.example.com', san: ['ha.example.com'] });
  const o = ortamKur();
  try {
    await o.yonetici.yukle();
    assert.equal(o.yonetici.karar(istek('ha.example.com', sunucu)), -3);
    assert.equal(o.yonetici.karar(istek('HA.Example.com', sunucu, 'net::OK')), -3);
  } finally {
    o.temizle();
  }
});

test('karar (parmak izi sabitleme): eşleşen yaprak 0; başka sertifika (sistem güvense bile), süresi dolmuş sabit sertifika ve veri yok -2; port önemsiz', async () => {
  const sabit = sertifikaUret({ cn: 'ha.example.com', san: ['ha.example.com'] });
  const baska = sertifikaUret({ cn: 'ha.example.com', san: ['ha.example.com'] });
  const o = ortamKur();
  try {
    await o.yonetici.yukle();
    assert.equal((await o.depo.sabitle('ha.example.com', sabit.parmakIzi)).ok, true);
    assert.equal(o.yonetici.karar(istek('ha.example.com', sabit)), 0);
    assert.equal(o.yonetici.karar(istek('ha.example.com', sabit, 'net::ERR_CERT_COMMON_NAME_INVALID')), 0, 'sabit sertifika ad uyumsuzluğunda da kabul: kimlik parmak izidir');
    assert.equal(o.yonetici.karar(istek('ha.example.com', baska, 'net::OK')), -2, 'sistem güvense bile başka sertifika reddedilir');
    assert.equal(o.yonetici.karar(istek('ha.example.com', baska)), -2);
    assert.equal(o.yonetici.karar({ hostname: 'ha.example.com', certificate: {}, verificationResult: 'net::OK' }), -2, 'sertifika verisi yoksa kabul yok');

    const dolmus = sertifikaUret({ cn: 'ha.example.com', san: ['ha.example.com'], baslangic: new Date(Date.now() - 400 * GUN), bitis: new Date(Date.now() - GUN) });
    await o.depo.sabitle('ha.example.com', dolmus.parmakIzi);
    assert.equal(o.yonetici.karar(istek('ha.example.com', dolmus)), -2, 'süresi dolmuş sertifika sabitli olsa da kabul edilmez');
  } finally {
    o.temizle();
  }
});

test('karar (özel kök CA): yalnız "yetkili geçersiz" durumunda zincir doğrulanırsa 0; diğer ret nedenleri, yanlış kök ve yanlış ad -3', async () => {
  const { ca, sunucu } = zincirUret({ sunucuAdi: 'ha.example.com', san: ['ha.example.com'] });
  const diger = zincirUret({ caAdi: 'Baska CA', sunucuAdi: 'ha.example.com', san: ['ha.example.com'] });
  const o = ortamKur();
  try {
    await o.yonetici.yukle();
    await o.depo.kokEkle([kokBilgisi(ca.pem)]);
    assert.equal(o.yonetici.karar(istek('ha.example.com', sunucu)), 0);
    assert.equal(o.yonetici.karar(istek('ha.example.com', sunucu, 'net::OK')), -3, 'sistem zaten güveniyorsa Chromium sonucu');
    for (const neden of ['net::ERR_CERT_DATE_INVALID', 'net::ERR_CERT_COMMON_NAME_INVALID', 'net::ERR_CERT_REVOKED', 'net::ERR_CERT_WEAK_KEY', '', null]) {
      assert.equal(o.yonetici.karar(istek('ha.example.com', sunucu, neden)), -3, `sistem reddi aşılmaz: ${neden}`);
    }
    assert.equal(o.yonetici.karar(istek('ha.example.com', diger.sunucu)), -3, 'başka CA imzalı sertifika');
    const yanlisAd = zincirUret({ sunucuAdi: 'baska.test', san: ['baska.test'] });
    await o.depo.kokEkle([kokBilgisi(yanlisAd.ca.pem)]);
    assert.equal(o.yonetici.karar(istek('ha.example.com', yanlisAd.sunucu)), -3, 'güvenilen CA imzalasa da sertifika bu ada ait değil');
    const dolmus = sertifikaUret({ cn: 'ha.example.com', san: ['ha.example.com'], veren: ca, baslangic: new Date(Date.now() - 400 * GUN), bitis: new Date(Date.now() - GUN) });
    assert.equal(o.yonetici.karar(istek('ha.example.com', dolmus)), -3, 'süresi dolmuş yaprak');
  } finally {
    o.temizle();
  }
});

test('karar (özel kök CA): sunucunun sunduğu ara sertifika issuerCert zincirinden okunur', async () => {
  const kok = sertifikaUret({ cn: 'Kok', ca: true });
  const ara = sertifikaUret({ cn: 'Ara', ca: true, veren: kok });
  const yaprak = sertifikaUret({ cn: 'ha.example.com', san: ['ha.example.com'], veren: ara });
  const o = ortamKur();
  try {
    await o.yonetici.yukle();
    await o.depo.kokEkle([kokBilgisi(kok.pem)]);
    assert.equal(o.yonetici.karar(istek('ha.example.com', yaprak, YETKILI_GECERSIZ, [ara.pem, kok.pem])), 0);
    assert.equal(o.yonetici.karar(istek('ha.example.com', yaprak, YETKILI_GECERSIZ, [ara.pem])), 0);
    assert.equal(o.yonetici.karar(istek('ha.example.com', yaprak, YETKILI_GECERSIZ, [])), -3, 'ara sertifika sunulmadıysa zincir kurulamaz');
  } finally {
    o.temizle();
  }
});

test('karar: sabitleme varsa özel kök yok sayılır (sıkı sabitleme); adres ayardan çıkınca kayıt o ana bilgisayarı artık etkilemez', async () => {
  const { ca, sunucu } = zincirUret({ sunucuAdi: 'ha.example.com', san: ['ha.example.com'] });
  const baska = sertifikaUret({ cn: 'ha.example.com', san: ['ha.example.com'] });
  const o = ortamKur();
  try {
    await o.yonetici.yukle();
    await o.depo.kokEkle([kokBilgisi(ca.pem)]);
    await o.depo.sabitle('ha.example.com', baska.parmakIzi);
    assert.equal(o.yonetici.karar(istek('ha.example.com', sunucu)), -2, 'CA imzalı sertifika sabitlenenden farklı');
    assert.equal(o.yonetici.karar(istek('ha.example.com', baska)), 0);
    o.ayarDegistir({ yerelAdres: 'https://192.168.1.50:8123', disAdres: 'https://yeni.example.com' });
    assert.equal(o.yonetici.karar(istek('ha.example.com', baska)), -3, 'artık HA adresi değil');
  } finally {
    o.temizle();
  }
});

test('canlı bağlantı seçenekleri: yalnız HA ana bilgisayarı ve wss; sabitleme yaprak denetimi, kök CA listesi; kayıt yoksa null', async () => {
  const { ca, sunucu } = zincirUret({ sunucuAdi: 'ha.example.com', san: ['ha.example.com'] });
  const baska = sertifikaUret({ cn: 'ha.example.com', san: ['ha.example.com'] });
  const o = ortamKur();
  try {
    await o.yonetici.yukle();
    assert.equal(o.yonetici.wsSecenekleri('wss://ha.example.com/api/websocket'), null, 'kayıt yok');
    await o.depo.kokEkle([kokBilgisi(ca.pem)]);
    const kokluSecenek = o.yonetici.wsSecenekleri('wss://ha.example.com/api/websocket');
    assert.deepEqual(Object.keys(kokluSecenek), ['ca']);
    assert.deepEqual(kokluSecenek.ca.map((p) => sertifikaParmagi(p)), [ca.parmakIzi]);
    assert.equal(o.yonetici.wsSecenekleri('wss://baska.example.net/'), null, 'HA dışı');
    assert.equal(o.yonetici.wsSecenekleri('ws://ha.example.com/api/websocket'), null, 'düz ws TLS değildir');
    assert.equal(o.yonetici.wsSecenekleri('bozuk'), null);

    await o.depo.sabitle('ha.example.com', sunucu.parmakIzi);
    const sabitSecenek = o.yonetici.wsSecenekleri('wss://ha.example.com/api/websocket');
    assert.deepEqual(Object.keys(sabitSecenek), ['yaprakDenetle'], 'sabitleme varsa kök listesi verilmez');
    assert.equal(sabitSecenek.yaprakDenetle(sunucu.der), true);
    assert.equal(sabitSecenek.yaprakDenetle(baska.der), false);
  } finally {
    o.temizle();
  }
});

test('oturum kancası: kayıt yokken kanca kalkar (varsayılan); kayıt eklenince kurulur ve karar verir; her değişiklik açık bağlantıları kapatır', async () => {
  const { ca, sunucu } = zincirUret({ sunucuAdi: 'ha.example.com', san: ['ha.example.com'] });
  const o = ortamKur();
  try {
    const oturum = sahteOturum();
    o.yonetici.oturumaBagla(oturum);
    o.yonetici.oturumaBagla(oturum); // ikinci bağlama yok sayılır
    // Kayıtlar bağlama anında eşzamanlı yüklenir: kanca kurulduğu an gelen istek kayıt bilinerek yanıtlanır (yarış yok)
    let erken = null;
    assert.equal(typeof oturum.proc, 'function');
    oturum.proc(istek('ha.example.com', sunucu), (k) => {
      erken = k;
    });
    assert.equal(erken, -3, 'kayıt yok: Chromium sonucu');
    await o.yonetici.hazir();
    await new Promise((coz) => setImmediate(coz));
    assert.equal(oturum.proc, null, 'yükleme bitince kayıt yoksa kanca kaldırılır');
    assert.equal(oturum.kapatma, 0, 'ilk yükleme bağlantıları kapatmaz');

    await o.depo.kokEkle([kokBilgisi(ca.pem)]);
    await new Promise((coz) => setImmediate(coz));
    assert.equal(typeof oturum.proc, 'function');
    assert.equal(await procCalistir(oturum, istek('ha.example.com', sunucu)), 0);
    assert.equal(await procCalistir(oturum, istek('baska.example.net', sunucu)), -3);
    assert.equal(oturum.kapatma, 1, 'güven değişti: açık bağlantılar kapatıldı');

    await o.depo.sabitle('ha.example.com', 'cd'.repeat(32));
    await new Promise((coz) => setImmediate(coz));
    assert.equal(oturum.kapatma, 2);
    assert.equal(await procCalistir(oturum, istek('ha.example.com', sunucu)), -2);

    await o.depo.sabitSil('ha.example.com');
    await o.depo.kokSil(o.depo.kokler()[0].parmak);
    await new Promise((coz) => setImmediate(coz));
    assert.equal(oturum.proc, null, 'tüm kayıtlar silinince kanca kalkar');
    assert.equal(oturum.kapatma, 4);
  } finally {
    o.temizle();
  }
});

test('oturum kancası (eşzamansız depo): kayıtlar yüklenirken gelen istek yüklemeyi bekler, sonra YÜKLENEN kayda göre yanıtlanır; ilk yükleme bağlantıları kapatmaz', async () => {
  const { ca, sunucu } = zincirUret({ sunucuAdi: 'ha.example.com', san: ['ha.example.com'] });
  const o = ortamKur({ gecikmeli: true, onceden: { surum: 1, ca: [{ pem: ca.pem }], sabit: [] } });
  try {
    const oturum = sahteOturum();
    o.yonetici.oturumaBagla(oturum);
    assert.equal(o.yonetici.hazirMi(), false, 'sınama düzeneği: depo henüz hazır değil');
    assert.equal(typeof oturum.proc, 'function', 'kayıt olup olmadığı bilinmiyorken kanca kurulur (istekler kayıtsız geçmesin)');
    const yanitlar = [];
    oturum.proc(istek('ha.example.com', sunucu), (k) => yanitlar.push(['ha', k]));
    oturum.proc(istek('baska.example.net', sunucu), (k) => yanitlar.push(['baska', k]));
    await new Promise((coz) => setImmediate(coz));
    assert.deepEqual(yanitlar, [], 'yükleme bitmeden karar verilmez (yüklenmemiş boş kayda göre -3 verilmez)');

    await o.yuklemeyiBitir();
    await new Promise((coz) => setImmediate(coz));
    assert.deepEqual(yanitlar.sort(), [['baska', -3], ['ha', 0]], 'bekleyen istekler yüklenen özel kök CA ile yanıtlandı');
    assert.equal(typeof oturum.proc, 'function', 'kayıt var: kanca kalır');
    assert.equal(oturum.kapatma, 0, 'ilk yükleme açık bağlantıları kapatmaz');
    assert.equal(await procCalistir(oturum, istek('ha.example.com', sunucu)), 0, 'hazır depoda istek hemen yanıtlanır');
  } finally {
    o.temizle();
  }
});

test('oturum kancası (eşzamansız depo): yükleme bitince kayıt yoksa bekleyen istek -3 alır ve kanca kalkar; yükleme hata verirse istek yine yanıtsız kalmaz', async () => {
  const { sunucu } = zincirUret({ sunucuAdi: 'ha.example.com', san: ['ha.example.com'] });
  const bos = ortamKur({ gecikmeli: true });
  try {
    const oturum = sahteOturum();
    bos.yonetici.oturumaBagla(oturum);
    let yanit = null;
    oturum.proc(istek('ha.example.com', sunucu), (k) => {
      yanit = k;
    });
    await new Promise((coz) => setImmediate(coz));
    assert.equal(yanit, null, 'yükleme bitmeden yanıt yok');
    await bos.yuklemeyiBitir();
    await new Promise((coz) => setImmediate(coz));
    assert.equal(yanit, -3, 'kayıt yok: Chromium sonucu');
    assert.equal(oturum.proc, null, 'kayıt yoksa kanca kaldırılır');
    assert.equal(oturum.kapatma, 0);
  } finally {
    bos.temizle();
  }

  const bozuk = ortamKur({ gecikmeli: true });
  try {
    const oturum = sahteOturum();
    bozuk.yonetici.oturumaBagla(oturum);
    let yanit = null;
    oturum.proc(istek('ha.example.com', sunucu), (k) => {
      yanit = k;
    });
    await bozuk.yuklemeyiBitir({ hata: true });
    await new Promise((coz) => setImmediate(coz));
    assert.equal(yanit, -3, 'yükleme başarısız: istek askıda kalmaz, Chromium sonucu verilir');
    assert.equal(typeof oturum.proc, 'function', 'hazır olmayan depoda kanca kaldırılmaz');
  } finally {
    bozuk.temizle();
  }
});

test('oturum kancası: kanca hatası (bozuk istek) -3 verir ve fırlatmaz; setCertificateVerifyProc olmayan oturum yok sayılır', async () => {
  const { ca } = zincirUret({ sunucuAdi: 'ha.example.com', san: ['ha.example.com'] });
  const o = ortamKur();
  try {
    await o.yonetici.yukle();
    await o.depo.kokEkle([kokBilgisi(ca.pem)]);
    const oturum = sahteOturum();
    o.yonetici.oturumaBagla(oturum);
    assert.equal(await procCalistir(oturum, { hostname: 'ha.example.com', certificate: { data: 'bozuk' }, verificationResult: YETKILI_GECERSIZ }), -3);
    assert.equal(await procCalistir(oturum, null), -3);
    o.yonetici.oturumaBagla({});
    o.yonetici.oturumaBagla(null);
  } finally {
    o.temizle();
  }
});

test('Ayarlar işleyicileri: durum PEM içermez; adresler ve sabitleme bayrağı; sunucu sertifikası okuma (veri yazmayan okuyucu) ve hata nedenleri', async () => {
  const sunucu = sertifikaUret({ cn: 'ha.test', san: ['ha.test', '192.168.1.50'] });
  const okumalar = [];
  const o = ortamKur({
    sertifikaOkuyucu: async (girdi) => {
      okumalar.push(girdi);
      return { ok: true, der: sunucu.der, sistemGuveniyor: false };
    },
  });
  try {
    await o.yonetici.yukle();
    const bos = o.yonetici.durum();
    assert.deepEqual(bos.adresler, [
      { tur: 'yerel', anaBilgisayar: '192.168.1.50', kapi: 8123, sabit: false },
      { tur: 'dis', anaBilgisayar: 'ha.example.com', kapi: 443, sabit: false },
    ]);
    assert.deepEqual([bos.enCokCa, bos.enCokSabit], [4, 4]);

    const okunan = await o.yonetici.sertifikaOku('yerel');
    assert.deepEqual(okumalar, [{ anaBilgisayar: '192.168.1.50', kapi: 8123 }]);
    assert.equal(okunan.ok, true);
    assert.equal(okunan.parmak, sunucu.parmakIzi);
    assert.match(okunan.parmakBicimli, /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    assert.equal(okunan.ad, 'ha.test');
    assert.deepEqual(okunan.sanlar, ['ha.test', '192.168.1.50']);
    assert.equal(okunan.sistemGuveniyor, false);
    assert.equal(okunan.tur, 'yerel');
    await o.yonetici.sertifikaOku('dis');
    assert.deepEqual(okumalar[1], { anaBilgisayar: 'ha.example.com', kapi: 443 });
    assert.equal((await o.yonetici.sertifikaOku('baska')).tur, 'yerel', 'bilinmeyen tür ev içi sayılır');
    assert.equal(o.depo.bos(), true, 'okumak hiçbir şeyi sabitlemez');

    o.ayarDegistir({ yerelAdres: 'http://192.168.1.50:8123', disAdres: '' });
    assert.deepEqual(await o.yonetici.sertifikaOku('yerel'), { ok: false, neden: 'https-degil' });
    assert.deepEqual(await o.yonetici.sertifikaOku('dis'), { ok: false, neden: 'adres-yok' });
    assert.equal(okumalar.length, 3, 'uygun olmayan adreslerde ağa çıkılmaz');
  } finally {
    o.temizle();
  }
});

test('Ayarlar işleyicileri: okuyucu hataları nedenle döner', async () => {
  for (const neden of ['baglanamadi', 'zaman-asimi', 'sertifika-yok']) {
    const o = ortamKur({ sertifikaOkuyucu: async () => ({ ok: false, neden }) });
    try {
      await o.yonetici.yukle();
      assert.deepEqual(await o.yonetici.sertifikaOku('yerel'), { ok: false, neden });
    } finally {
      o.temizle();
    }
  }
  const bozuk = ortamKur({ sertifikaOkuyucu: async () => ({ ok: true, der: Buffer.from('bozuk'), sistemGuveniyor: true }) });
  try {
    await bozuk.yonetici.yukle();
    assert.deepEqual(await bozuk.yonetici.sertifikaOku('yerel'), { ok: false, neden: 'sertifika-yok' });
  } finally {
    bozuk.temizle();
  }
});

test('Ayarlar işleyicileri: parmak izi sabitle / kaldır — biçimler normalleşir, ana bilgisayar ayardaki adresten gelir, geçersiz girdi reddedilir', async () => {
  const sunucu = sertifikaUret({ cn: 'ha.test', san: ['ha.test'] });
  const o = ortamKur();
  try {
    await o.yonetici.yukle();
    const bicimli = sunucu.parmakIzi.toUpperCase().replace(/(..)(?!$)/g, '$1:');
    const sonuc = await o.yonetici.parmakKaydet('dis', `SHA256 Fingerprint=${bicimli}`);
    assert.equal(sonuc.ok, true);
    assert.deepEqual(sonuc.sertifika.sabit.map((s) => [s.anaBilgisayar, s.parmak]), [['ha.example.com', sunucu.parmakIzi]]);
    assert.equal(sonuc.sertifika.adresler.find((a) => a.tur === 'dis').sabit, true);
    assert.equal(JSON.stringify(sonuc).includes('BEGIN CERTIFICATE'), false);

    assert.deepEqual(await o.yonetici.parmakKaydet('dis', 'kisa'), { ok: false, neden: 'parmak-gecersiz' });
    assert.deepEqual(await o.yonetici.parmakKaydet('dis', null), { ok: false, neden: 'parmak-gecersiz' });
    o.ayarDegistir({ yerelAdres: 'http://192.168.1.50:8123', disAdres: 'https://ha.example.com' });
    assert.deepEqual(await o.yonetici.parmakKaydet('yerel', sunucu.parmakIzi), { ok: false, neden: 'https-degil' }, 'http adrese sabitlenmez');

    assert.deepEqual(await o.yonetici.parmakSil('olmayan.test'), { ok: false, neden: 'yok' });
    const silinen = await o.yonetici.parmakSil('HA.example.com');
    assert.equal(silinen.ok, true);
    assert.deepEqual(silinen.sertifika.sabit, []);
    assert.equal(o.gunluk.some((m) => /[0-9a-f]{16}/i.test(m)), false, 'günlükte parmak izi yok');
  } finally {
    o.temizle();
  }
});

test('Ayarlar işleyicileri: kök sertifika ekle — PEM ve DER dosyası eklenir; özel anahtar, kök olmayan, boş, büyük ve eksik dosya reddedilir; iptal hata değildir', async () => {
  const kok = sertifikaUret({ cn: 'Ev Kok CA', ca: true });
  const yaprak = sertifikaUret({ cn: 'ha.test', san: ['ha.test'] });
  const klasor = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-paneli-dosya-'));
  const dosya = (ad, icerik) => {
    const yol = path.join(klasor, ad);
    fs.writeFileSync(yol, icerik);
    return yol;
  };
  let secilecek = null;
  const o = ortamKur({ dosyaSec: async () => secilecek });
  try {
    await o.yonetici.yukle();

    secilecek = null;
    assert.deepEqual(await o.yonetici.kokEkle(), { ok: false, iptal: true });

    secilecek = dosya('kok.pem', kok.pem);
    const eklendi = await o.yonetici.kokEkle();
    assert.equal(eklendi.ok, true);
    assert.equal(eklendi.eklenen, 1);
    assert.equal(eklendi.atlanan, 0);
    assert.deepEqual(eklendi.sertifika.ca.map((k) => [k.parmak, k.ad]), [[kok.parmakIzi, 'Ev Kok CA']]);
    assert.equal(JSON.stringify(eklendi).includes('BEGIN CERTIFICATE'), false, 'PEM arayüze gitmez');

    secilecek = dosya('kok.pem', kok.pem);
    assert.equal((await o.yonetici.kokEkle()).eklenen, 0, 'aynı kök ikinci kez eklenmez');

    const ikinci = sertifikaUret({ cn: 'Ikinci Kok', ca: true });
    secilecek = dosya('ikinci.cer', ikinci.der);
    assert.equal((await o.yonetici.kokEkle()).ok, true, 'DER (.cer)');

    secilecek = dosya('anahtarli.pem', `${yaprak.pem}\n${yaprak.privateKeyPem}`);
    assert.deepEqual(await o.yonetici.kokEkle(), { ok: false, neden: 'ozel-anahtar' });
    secilecek = dosya('yaprak.pem', yaprak.pem);
    assert.deepEqual(await o.yonetici.kokEkle(), { ok: false, neden: 'ca-degil' });
    const ara = sertifikaUret({ cn: 'Ara', ca: true, veren: kok });
    secilecek = dosya('ara.pem', ara.pem);
    assert.deepEqual(await o.yonetici.kokEkle(), { ok: false, neden: 'kok-degil' });
    const karisik = sertifikaUret({ cn: 'Ucuncu Kok', ca: true });
    secilecek = dosya('karisik.pem', `${karisik.pem}\n${yaprak.pem}`);
    const kismi = await o.yonetici.kokEkle();
    assert.equal(kismi.ok, true);
    assert.equal(kismi.eklenen, 1);
    assert.equal(kismi.atlanan, 1, 'dosyadaki uygun olmayan sertifika atlanır');

    secilecek = dosya('bos.pem', '');
    assert.deepEqual(await o.yonetici.kokEkle(), { ok: false, neden: 'dosyada-yok' });
    secilecek = dosya('buyuk.pem', Buffer.alloc(70 * 1024, 65));
    assert.deepEqual(await o.yonetici.kokEkle(), { ok: false, neden: 'cok-buyuk' });
    secilecek = path.join(klasor, 'yok.pem');
    assert.deepEqual(await o.yonetici.kokEkle(), { ok: false, neden: 'okunamadi' });
    secilecek = klasor;
    assert.deepEqual(await o.yonetici.kokEkle(), { ok: false, neden: 'okunamadi' }, 'klasör dosya değildir');

    assert.equal(o.depo.kokler().length, 3);
    const dortuncu = sertifikaUret({ cn: 'Dorduncu Kok', ca: true });
    secilecek = dosya('dort.pem', dortuncu.pem);
    assert.equal((await o.yonetici.kokEkle()).ok, true);
    const besinci = sertifikaUret({ cn: 'Besinci Kok', ca: true });
    secilecek = dosya('bes.pem', besinci.pem);
    assert.deepEqual(await o.yonetici.kokEkle(), { ok: false, neden: 'cok-fazla' });
    assert.equal(o.gunluk.some((m) => /BEGIN|[0-9a-f]{16}/i.test(m)), false, 'günlükte sertifika/parmak izi yok');
  } finally {
    fs.rmSync(klasor, { recursive: true, force: true });
    o.temizle();
  }
});

test('Ayarlar işleyicileri: dosya seçme penceresi hatası; kök sertifika kaldırma parmak izini doğrular', async () => {
  const kok = sertifikaUret({ cn: 'Ev Kok CA', ca: true });
  const o = ortamKur({
    dosyaSec: async () => {
      throw new Error('diyalog');
    },
  });
  try {
    await o.yonetici.yukle();
    assert.deepEqual(await o.yonetici.kokEkle(), { ok: false, neden: 'diyalog-acilamadi' });
    await o.depo.kokEkle([kokBilgisi(kok.pem)]);
    assert.deepEqual(await o.yonetici.kokSil('kisa'), { ok: false, neden: 'parmak-gecersiz' });
    assert.deepEqual(await o.yonetici.kokSil(kok.parmakIzi.toUpperCase()), { ok: false, neden: 'parmak-gecersiz' });
    assert.deepEqual(await o.yonetici.kokSil('00'.repeat(32)), { ok: false, neden: 'yok' });
    const silindi = await o.yonetici.kokSil(kok.parmakIzi);
    assert.equal(silindi.ok, true);
    assert.deepEqual(silindi.sertifika.ca, []);
  } finally {
    o.temizle();
  }
});

test('IPC çiftleri: beş kanal, hepsi baglanti: önekli ve işlevli', async () => {
  const o = ortamKur();
  try {
    const ciftler = o.yonetici.ipcIsleyicileri();
    assert.deepEqual(
      ciftler.map(([kanal]) => kanal),
      ['baglanti:sertifika-oku', 'baglanti:parmak-kaydet', 'baglanti:parmak-sil', 'baglanti:ca-ekle', 'baglanti:ca-sil'],
    );
    for (const [, isleyici] of ciftler) assert.equal(typeof isleyici, 'function');
  } finally {
    o.temizle();
  }
});
