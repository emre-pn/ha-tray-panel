'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { etkinlikGecmisiOlustur, kaydiDuzelt, kayitlariDuzelt, EN_COK_KAYIT } = require('../src/lib/etkinlik-gecmisi');
const { sahteFs, sahteSaat } = require('./eylem-sahte');

const YOL = 'C:\\veri\\etkinlik-gecmisi.json';

function kur({ fs = sahteFs(), acik = true } = {}) {
  const saat = sahteSaat();
  const gunlukler = [];
  const g = etkinlikGecmisiOlustur({ dosyaYolu: YOL, fs, simdi: saat.simdi, zaman: saat, gunluk: (m) => gunlukler.push(m), acikMi: typeof acik === 'function' ? acik : () => acik }); // işlev: ayar çalışırken değiştirilebilir
  return { g, fs, saat, gunlukler };
}

test('ekle: en yeni başta, kaynak/kimlik/ad/işlem/sonuç saklanır, zaman saatten gelir', () => {
  const { g, saat } = kur();
  assert.equal(g.ekle({ kaynak: 'panel', kimlik: 'light.salon', ad: 'Salon lambası', islem: 'toggle', sonuc: 'ok' }), true);
  saat.uyku(1000);
  assert.equal(g.ekle({ kaynak: 'gecikmeli', kimlik: 'switch.priz', ad: 'Masa prizi', islem: 'turn_off', sonuc: 'hata', neden: 'ha-hatasi/ag' }), true);
  const liste = g.liste();
  assert.deepEqual(liste.map((k) => k.kimlik), ['switch.priz', 'light.salon']);
  assert.deepEqual(liste[0], { zaman: liste[0].zaman, kaynak: 'gecikmeli', kimlik: 'switch.priz', ad: 'Masa prizi', islem: 'turn_off', sonuc: 'hata', neden: 'ha-hatasi/ag' });
  assert.equal(liste[0].zaman - liste[1].zaman, 1000);
  liste[0].kaynak = 'bozuldu';
  assert.equal(g.liste()[0].kaynak, 'gecikmeli', 'liste kopya döner');
});

test('halka tampon: en çok 200 kayıt, en eskisi düşer', () => {
  const { g } = kur();
  for (let i = 0; i < EN_COK_KAYIT + 30; i += 1) g.ekle({ kaynak: 'panel', kimlik: `switch.priz_${i}`, islem: 'toggle', sonuc: 'ok' });
  assert.equal(g.sayi(), EN_COK_KAYIT);
  assert.equal(g.liste(1)[0].kimlik, `switch.priz_${EN_COK_KAYIT + 29}`);
  assert.equal(g.liste().at(-1).kimlik, 'switch.priz_30');
});

test('Kapı Kuralı: kapı/kilit/alarm kimliği ya da adı taşıyan kayıt HİÇ yazılmaz (kimlikte, adda, kimliksiz kayıtta ad)', () => {
  const { g } = kur();
  const kotuler = [
    { kimlik: 'lock.on_kapi' },
    { kimlik: 'cover.garaj' },
    { kimlik: 'alarm_control_panel.ev' },
    { kimlik: 'light.garaj_isigi' },
    { kimlik: 'light.salon', ad: 'Ön Kapı lambası' },
    { kimlik: 'switch.priz', ad: 'Kilit prizi' },
    { kimlik: 'KÖTÜ' },
    { kimlik: 5 },
    { ad: 'Salon' }, // kimliksiz kayıtta ad olmaz
  ];
  for (const k of kotuler) assert.equal(g.ekle({ kaynak: 'panel', islem: 'toggle', sonuc: 'ok', ...k }), false, JSON.stringify(k));
  assert.equal(g.sayi(), 0);
  // kimliksiz kayıt (ör. oda kapatma özeti) serbest
  assert.equal(g.ekle({ kaynak: 'panel', islem: 'oda-kapat', sonuc: 'ok' }), true);
});

test('biçim: kaynak/işlem/sonuç/neden desenleri; ham nesne, dizi, fazladan alan kabul edilmez ya da atılır', () => {
  const { g } = kur();
  for (const kotu of [
    null,
    [],
    'x',
    { kaynak: 'Panel', islem: 'toggle', sonuc: 'ok' },
    { kaynak: 'panel', islem: 'Toggle!', sonuc: 'ok' },
    { kaynak: 'panel', islem: 'toggle', sonuc: 'belki' },
    { kaynak: 'panel', islem: 'toggle', sonuc: 'hata', neden: 'http://10.0.0.5:8123/api?token=abc' },
    { kaynak: 'panel', islem: 'toggle', sonuc: 'ok', ad: 5, kimlik: 'light.salon' },
  ]) {
    assert.equal(g.ekle(kotu), false, JSON.stringify(kotu));
  }
  g.ekle({ kaynak: 'panel', kimlik: 'light.salon', islem: 'toggle', sonuc: 'ok', erisimAnahtari: 'gizli', govde: { x: 1 }, adres: 'http://ha.local' });
  assert.deepEqual(Object.keys(g.liste()[0]).sort(), ['islem', 'kaynak', 'kimlik', 'sonuc', 'zaman']);
  assert.ok(!JSON.stringify(g.liste()).includes('gizli') && !JSON.stringify(g.liste()).includes('ha.local'));
});

test('ad kısaltılır (60 karakter)', () => {
  const { g } = kur();
  g.ekle({ kaynak: 'panel', kimlik: 'light.salon', ad: 'a'.repeat(200), islem: 'toggle', sonuc: 'ok' });
  assert.equal(g.liste()[0].ad.length, 60);
});

test('ayar kapalıyken ekle() hiçbir şey yazmaz; temizle yine çalışır', async () => {
  const { g, fs, saat } = kur({ acik: false });
  assert.equal(g.ekle({ kaynak: 'panel', kimlik: 'light.salon', islem: 'toggle', sonuc: 'ok' }), false);
  assert.equal(g.sayi(), 0);
  assert.equal(saat.bekleyen(), 0, 'kapalıyken zamanlayıcı kurulmaz');
  await saat.ileri(1000);
  assert.equal(fs.yazimlar.length, 0);

  // Kullanıcı geçmiş açıkken kayıt biriktirip sonra ayarı kapatırsa: kayıtlar kalır, temizle yine silip dosyaya yazar
  let acik = true;
  const k = kur({ acik: () => acik });
  k.g.ekle({ kaynak: 'panel', kimlik: 'light.salon', islem: 'toggle', sonuc: 'ok' });
  await k.saat.ileri(600);
  assert.equal(JSON.parse(k.fs.dosyalar.get(YOL)).kayitlar.length, 1, 'açıkken kayıt yazıldı');
  acik = false;
  assert.equal(k.g.ekle({ kaynak: 'panel', kimlik: 'switch.priz', islem: 'turn_off', sonuc: 'ok' }), false, 'kapalıyken yeni kayıt girmez');
  assert.equal(k.g.sayi(), 1, 'kapatmak eski kayıtları silmez');
  const yazimOnce = k.fs.yazimlar.length;
  await k.saat.ileri(1000);
  assert.equal(k.fs.yazimlar.length, yazimOnce, 'kapalıyken ekle() yazma planlamaz');
  k.g.temizle();
  assert.equal(k.g.sayi(), 0, 'temizle kapalıyken de listeyi boşaltır');
  await k.saat.ileri(600);
  assert.deepEqual(JSON.parse(k.fs.dosyalar.get(YOL)).kayitlar, [], 'temizle kapalıyken de dosyaya yazılır');
});

test('yazma: gecikmeli ve atomik (.tmp + yeniden adlandırma); bosalt hemen yazar; kirli değilse yazmaz; dosyada sır alanı yok', async () => {
  const { g, fs, saat } = kur();
  g.ekle({ kaynak: 'panel', kimlik: 'light.salon', islem: 'toggle', sonuc: 'ok' });
  g.ekle({ kaynak: 'palet', kimlik: 'switch.priz', islem: 'turn_off', sonuc: 'ok' });
  assert.equal(fs.yazimlar.length, 0, 'gecikmeli');
  assert.equal(saat.bekleyen(), 1, 'tek zamanlayıcı');
  await saat.ileri(600);
  assert.deepEqual(fs.yazimlar, [`${YOL}.tmp`]);
  assert.ok(fs.dosyalar.has(YOL) && !fs.dosyalar.has(`${YOL}.tmp`));
  const icerik = JSON.parse(fs.dosyalar.get(YOL));
  assert.equal(icerik.surum, 1);
  assert.deepEqual(icerik.kayitlar.map((k) => k.kimlik), ['switch.priz', 'light.salon']);
  g.bosalt();
  assert.equal(fs.yazimlar.length, 1, 'kirli değilken yazılmaz');
  g.ekle({ kaynak: 'panel', kimlik: 'light.yatak', islem: 'toggle', sonuc: 'ok' });
  g.bosalt();
  assert.equal(fs.yazimlar.length, 2, 'bosalt bekleyen yazmayı hemen yapar');
});

test('yukle: kayıtlar geri gelir; bozuk dosya boş başlatır; elle bozulmuş dosyadaki kapı kaydı ve geçersiz satır atılır', () => {
  const dosya = JSON.stringify({
    surum: 1,
    kayitlar: [
      { zaman: 5, kaynak: 'panel', kimlik: 'light.salon', ad: 'Salon', islem: 'toggle', sonuc: 'ok' },
      { zaman: 4, kaynak: 'panel', kimlik: 'lock.on_kapi', islem: 'toggle', sonuc: 'ok' },
      { zaman: 3, kaynak: 'panel', kimlik: 'light.salon', ad: 'Garaj kapısı', islem: 'toggle', sonuc: 'ok' },
      { zaman: 2, kaynak: 'X', islem: 'toggle', sonuc: 'ok' },
      'çöp',
      { zaman: 1, kaynak: 'tepsi-menu', kimlik: 'switch.priz', islem: 'turn_on', sonuc: 'hata', neden: 'ulasilamiyor' },
    ],
  });
  const { g } = kur({ fs: sahteFs({ [YOL]: dosya }) });
  assert.equal(g.yukle(), 2);
  assert.deepEqual(g.liste().map((k) => k.kimlik), ['light.salon', 'switch.priz']);
  const bozuk = kur({ fs: sahteFs({ [YOL]: '{bozuk' }) });
  assert.equal(bozuk.g.yukle(), 0);
  assert.equal(bozuk.gunlukler.length, 1);
  assert.ok(!bozuk.gunlukler[0].includes('bozuk'), 'günlük dosya içeriğini taşımaz');
  const yok = kur();
  assert.equal(yok.g.yukle(), 0);
  assert.deepEqual(kayitlariDuzelt(null), []);
});

test('yazma hatası günlüğe kısa mesaj bırakır, uygulamayı çökertmez', () => {
  const fs = sahteFs();
  fs.writeFileSync = () => {
    throw new Error('disk dolu: C:\\gizli\\yol');
  };
  const { g, gunlukler } = kur({ fs });
  g.ekle({ kaynak: 'panel', kimlik: 'light.salon', islem: 'toggle', sonuc: 'ok' });
  assert.equal(g.bosalt(), false);
  assert.equal(gunlukler.length, 1);
  assert.ok(!gunlukler[0].includes('gizli'));
});

test('temizle: listeyi boşaltır ve dosyaya yazılır; dinleyici ekleme ve temizlemede haber alır; kaldırılabilir', async () => {
  const { g, fs, saat } = kur();
  let sayac = 0;
  const birak = g.dinle(() => {
    sayac += 1;
  });
  g.ekle({ kaynak: 'panel', kimlik: 'light.salon', islem: 'toggle', sonuc: 'ok' });
  g.temizle();
  assert.equal(sayac, 2);
  assert.equal(g.sayi(), 0);
  await saat.ileri(600);
  assert.deepEqual(JSON.parse(fs.dosyalar.get(YOL)).kayitlar, []);
  birak();
  g.ekle({ kaynak: 'panel', kimlik: 'light.salon', islem: 'toggle', sonuc: 'ok' });
  assert.equal(sayac, 2);
  g.dinle(() => {
    throw new Error('dinleyici hatası');
  });
  assert.equal(g.ekle({ kaynak: 'panel', kimlik: 'light.salon', islem: 'toggle', sonuc: 'ok' }), true, 'dinleyici hatası kaydı bozmaz');
});

test('kaydiDuzelt: zaman yoksa varsayılan, geçerli zaman korunur', () => {
  assert.equal(kaydiDuzelt({ kaynak: 'panel', islem: 'oda-kapat', sonuc: 'ok' }, 77).zaman, 77);
  assert.equal(kaydiDuzelt({ zaman: 12, kaynak: 'panel', islem: 'oda-kapat', sonuc: 'ok' }, 77).zaman, 12);
});

test('yukle: geçici okuma hatası (EBUSY) bozulma sayılmaz; dosya ezilmez, okunabilince diskteki kayıtlar korunarak birleştirilir', () => {
  const eski = JSON.stringify({ surum: 1, kayitlar: Array.from({ length: 150 }, (_, i) => ({ zaman: 1000 - i, kaynak: 'panel', kimlik: 'light.salon', islem: 'toggle', sonuc: 'ok' })) });
  const fs = sahteFs({ [YOL]: eski });
  const gercekOku = fs.readFileSync;
  let kilitli = true;
  fs.readFileSync = (y, k) => {
    if (kilitli) throw Object.assign(new Error('meşgul'), { code: 'EBUSY' });
    return gercekOku(y, k);
  };
  const { g, gunlukler } = kur({ fs });
  assert.equal(g.yukle(), 0);
  assert.deepEqual(gunlukler, ['Etkinlik geçmişi dosyası okunamadı; yazma ertelendi.']);
  g.ekle({ kaynak: 'panel', kimlik: 'switch.priz', islem: 'turn_on', sonuc: 'ok' });
  assert.equal(g.bosalt(), false, 'dosya hâlâ kilitli: yazılmaz');
  assert.equal(fs.dosyalar.get(YOL), eski, 'özgün dosya değişmedi');
  assert.equal(fs.yazimlar.length, 0);
  kilitli = false;
  assert.equal(g.bosalt(), true);
  const yazilan = JSON.parse(fs.dosyalar.get(YOL)).kayitlar;
  assert.equal(yazilan.length, 151, '150 eski + 1 yeni');
  assert.equal(yazilan[0].kimlik, 'switch.priz', 'yeni kayıt zaman sırasına göre başta');
  assert.equal(g.sayi(), 151);
});

test('temizle: okuma hatası sürerken kullanıcı temizlerse dosya bilerek sıfırlanır; bozuk JSON yine boş başlar', () => {
  const fs = sahteFs({ [YOL]: JSON.stringify({ surum: 1, kayitlar: [{ zaman: 5, kaynak: 'panel', kimlik: 'light.salon', islem: 'toggle', sonuc: 'ok' }] }) });
  const gercekOku = fs.readFileSync;
  fs.readFileSync = () => {
    throw new Error('meşgul');
  };
  const { g } = kur({ fs });
  g.yukle();
  g.temizle();
  assert.equal(g.bosalt(), true);
  assert.deepEqual(JSON.parse(fs.dosyalar.get(YOL)).kayitlar, []);
  fs.readFileSync = gercekOku;

  const bozuk = kur({ fs: sahteFs({ [YOL]: '{bozuk' }) });
  bozuk.g.yukle();
  bozuk.g.ekle({ kaynak: 'panel', kimlik: 'light.salon', islem: 'toggle', sonuc: 'ok' });
  assert.equal(bozuk.g.bosalt(), true);
  assert.equal(JSON.parse(bozuk.fs.dosyalar.get(YOL)).kayitlar.length, 1);
});
