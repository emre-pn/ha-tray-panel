'use strict';

/**
 * Ayarlar > Bağlantı > Sertifika güveni (o-56; src/ayarlar-sertifika.js). Sahte DOM ve sahte köprü (test/ayarlar-sahte.js,
 * test/baglanti-sahte.js); gerçek ağ, Electron ya da dosya seçimi yok.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { AYAR_D3, CIHAZLAR_D3, HTML, akit, acilmisSayfa } = require('./ayarlar-sahte');
const { SAHTE_PARMAK } = require('./baglanti-sahte');
const AYARLAR = require('../src/lib/ceviri/ayarlar');

const P = 'ayar.baglanti.sert.';
const bicimle = (hex) => hex.toUpperCase().replace(/(..)(?!$)/g, '$1:');
const doldur = (metin, d = {}) => metin.replace(/\{(\w+)\}/g, (_, k) => String(d[k]));
const tr = (anahtar, d) => doldur(AYARLAR.tr[anahtar], d);

const ac = (baglantiYaniti = {}, ek = {}) => acilmisSayfa({ ayar: AYAR_D3, cihazlar: CIHAZLAR_D3, baglantiYaniti, ...ek });
const dugmeler = (sayfa, kimlik) => sayfa.oge(kimlik).bul((e) => e.etiket === 'button');
const dugme = (sayfa, kimlik, metin) => dugmeler(sayfa, kimlik).find((d) => d.textContent === metin);
const tikla = async (oge) => {
  assert.ok(oge, 'düğme bulunamadı');
  oge.dispatchEvent({ type: 'click' });
  await akit();
};
const sertCagrilari = (sayfa) => sayfa.cagrilar.filter((c) => ['sertifikaOku', 'parmakIziniSabitle', 'parmakSabitlemeyiKaldir', 'kokSertifikaEkle', 'kokSertifikayiKaldir'].includes(c[0]));
const durumMetni = (sayfa) => sayfa.oge('sertifikaDurum').textContent;
const adresMetinleri = (sayfa) => sayfa.oge('sertifikaAdresListesi').children.map((k) => k.children.map((c) => c.textContent));
const OKUNAN = (sayfa) => sayfa.oge('sertifikaOkunan');

test('açılış: ayardaki https adresler sabitlenmemiş görünür; kök sertifika listesi boş; okunan paneli gizli', async () => {
  const sayfa = await ac();
  const blok = adresMetinleri(sayfa);
  assert.equal(blok.length, 2);
  assert.equal(blok[0][0], tr(`${P}adresYerel`, { ana: '192.168.1.50:8123' }));
  assert.equal(blok[0][1], tr(`${P}sabitYok`));
  assert.equal(blok[1][0], tr(`${P}adresDis`, { ana: 'ha.example.com' }), 'varsayılan kapı 443 yazılmaz');
  assert.equal(sayfa.oge('sertifikaCaListesi').children[0].textContent, tr(`${P}caYok`));
  assert.equal(OKUNAN(sayfa).style.display, 'none');
  assert.equal(sayfa.oge('btnSertifikaCaEkle').disabled, false);
  assert.deepEqual(sertCagrilari(sayfa), [], 'açılışta eylem çağrılmaz');
});

test('açılış: https adres yoksa açıklayıcı ileti gösterilir, okuma/elle girme düğmesi çıkmaz', async () => {
  const sayfa = await ac({ sertifikaAdresleri: [] });
  assert.equal(sayfa.oge('sertifikaAdresListesi').children.length, 1);
  assert.equal(sayfa.oge('sertifikaAdresListesi').children[0].textContent, tr(`${P}adresYok`));
  assert.equal(dugmeler(sayfa, 'sertifikaAdresListesi').length, 0);
});

test('sunucu sertifikasını oku: bilgiler gösterilir ama SABİTLEME yapılmaz; kullanıcı onaylayınca sabitlenir ve panel kapanır', async () => {
  const sayfa = await ac();
  await tikla(dugme(sayfa, 'sertifikaAdresListesi', tr(`${P}oku`)));
  assert.deepEqual(sertCagrilari(sayfa), [['sertifikaOku', 'yerel']]);
  const panel = OKUNAN(sayfa);
  assert.equal(panel.style.display, '');
  const metinler = panel.children.map((c) => c.textContent);
  assert.ok(metinler.includes(tr(`${P}okunanBaslik`)));
  assert.ok(metinler.includes(tr(`${P}okunanKonu`, { ad: 'ha.test' })));
  assert.ok(metinler.includes(tr(`${P}okunanVeren`, { ad: 'Test Kok CA' })));
  assert.ok(metinler.includes(tr(`${P}okunanGecerlilik`, { bas: '2026-01-01', bit: '2030-01-01' })));
  assert.ok(metinler.includes(tr(`${P}okunanAdlar`, { adlar: 'ha.test, 192.168.1.50' })));
  assert.ok(metinler.includes(bicimle(SAHTE_PARMAK)), 'parmak izi iki noktalı büyük harf biçiminde');
  assert.ok(metinler.includes(tr(`${P}okunanSistem0`)));
  assert.ok(metinler.includes(tr(`${P}okunanUyari`)), 'karşılaştırma uyarısı gösterilir');
  assert.equal(sayfa.baglantiDeposu.sertifikaSabit.length, 0, 'okumak sabitlemez');
  assert.equal(durumMetni(sayfa), tr(`${P}okundu`), 'sonuç canlı bölgedeki durum satırında duyurulur ("Sınanıyor…" boş bırakılmaz)');
  assert.equal(sayfa.oge('sertifikaDurum').className, 'ipucu');

  await tikla(dugme(sayfa, 'sertifikaOkunan', tr(`${P}okunanSabitle`)));
  assert.deepEqual(sertCagrilari(sayfa)[1], ['parmakIziniSabitle', 'yerel', SAHTE_PARMAK]);
  assert.equal(durumMetni(sayfa), tr(`${P}sabitlendi`));
  assert.equal(OKUNAN(sayfa).style.display, 'none');
  assert.equal(adresMetinleri(sayfa)[0][1], tr(`${P}sabitDurum`, { parmak: bicimle(SAHTE_PARMAK) }));
  assert.ok(dugme(sayfa, 'sertifikaAdresListesi', tr(`${P}sabitKaldir`)), 'sabitli adreste kaldır düğmesi çıkar');
});

test('okunan sertifika panelinde Vazgeç: panel kapanır, sabitleme çağrısı gitmez; dış adres için tur dis gider; Windows güveniyorsa ilgili ileti', async () => {
  const sayfa = await ac({
    sertifikaOku: (tur) => ({
      ok: true, tur, anaBilgisayar: 'ha.example.com', kapi: 443, parmak: SAHTE_PARMAK, parmakBicimli: bicimle(SAHTE_PARMAK), ad: 'ha.example.com', veren: 'R3',
      sanlar: [], baslangic: '2026-01-01T12:00:00.000Z', bitis: '2026-04-01T12:00:00.000Z', kendindenImzali: false, sistemGuveniyor: true,
    }),
  });
  const dugmeSirasi = dugmeler(sayfa, 'sertifikaAdresListesi').filter((d) => d.textContent === tr(`${P}oku`));
  await tikla(dugmeSirasi[1]);
  assert.deepEqual(sertCagrilari(sayfa), [['sertifikaOku', 'dis']]);
  const metinler = OKUNAN(sayfa).children.map((c) => c.textContent);
  assert.ok(metinler.includes(tr(`${P}okunanSistem1`)));
  assert.ok(!metinler.some((m) => m.startsWith('Adlar:')), 'ad listesi boşsa satır yazılmaz');
  await tikla(dugme(sayfa, 'sertifikaOkunan', tr(`${P}okunanVazgec`)));
  assert.equal(OKUNAN(sayfa).style.display, 'none');
  assert.equal(sertCagrilari(sayfa).length, 1);
});

test('okuma hataları: neden kodu ilgili iletiye çevrilir', async () => {
  for (const [neden, anahtar] of [['baglanamadi', 'hata.baglanamadi'], ['zaman-asimi', 'hata.zamanAsimi'], ['sertifika-yok', 'hata.sertifikaYok'], ['https-degil', 'hata.adresYok'], ['bilinmeyen-kod', 'hata.genel']]) {
    const sayfa = await ac({ sertifikaOku: () => ({ ok: false, neden }) });
    await tikla(dugme(sayfa, 'sertifikaAdresListesi', tr(`${P}oku`)));
    assert.equal(durumMetni(sayfa), tr(P + anahtar), neden);
    assert.ok(sayfa.oge('sertifikaDurum').className.includes('alan-sonuc-sorun'));
    assert.equal(OKUNAN(sayfa).style.display, 'none');
  }
});

test('parmak izini elle gir: alan açılır; geçersiz değer hata verir; geçerli değer (iki noktalı) sabitlenir', async () => {
  const sayfa = await ac();
  await tikla(dugme(sayfa, 'sertifikaAdresListesi', tr(`${P}elleGir`)));
  const alan = () => sayfa.oge('sertifikaAdresListesi').bul((e) => e.etiket === 'input')[0];
  assert.ok(alan(), 'giriş alanı açıldı');
  assert.equal(alan().attributes['aria-label'], tr(`${P}parmakEtiketi`));
  assert.equal(alan().placeholder, 'AA:BB:CC:…');

  alan().value = 'kisa';
  alan().dispatchEvent({ type: 'input' });
  await tikla(dugme(sayfa, 'sertifikaAdresListesi', tr(`${P}sabitle`)));
  assert.deepEqual(sertCagrilari(sayfa).at(-1), ['parmakIziniSabitle', 'yerel', 'kisa']);
  assert.equal(durumMetni(sayfa), tr(`${P}hata.parmakGecersiz`));
  assert.equal(alan().value, 'kisa', 'yanlış girilen değer korunur (düzeltilebilsin)');

  alan().value = bicimle(SAHTE_PARMAK);
  alan().dispatchEvent({ type: 'input' });
  await tikla(dugme(sayfa, 'sertifikaAdresListesi', tr(`${P}sabitle`)));
  assert.equal(durumMetni(sayfa), tr(`${P}sabitlendi`));
  assert.equal(alan(), undefined, 'başarıdan sonra giriş alanı kapanır');
  assert.equal(sayfa.baglantiDeposu.sertifikaSabit[0].parmak, SAHTE_PARMAK);
});

test('sabitlemeyi kaldır: onay reddedilirse çağrı gitmez; onaylanırsa ana bilgisayar adıyla kaldırılır', async () => {
  const red = await acilmisSayfa({ ayar: AYAR_D3, cihazlar: CIHAZLAR_D3, onayYaniti: false, baglantiYaniti: { sertifikaSabit: [{ anaBilgisayar: 'ha.example.com', parmak: SAHTE_PARMAK }] } });
  await tikla(dugme(red, 'sertifikaAdresListesi', tr(`${P}sabitKaldir`)));
  assert.deepEqual(sertCagrilari(red), []);
  assert.deepEqual(red.sorular, [tr(`${P}sabitKaldirOnay`)]);

  const sayfa = await ac({ sertifikaSabit: [{ anaBilgisayar: 'ha.example.com', parmak: SAHTE_PARMAK }] });
  assert.equal(adresMetinleri(sayfa)[1][1], tr(`${P}sabitDurum`, { parmak: bicimle(SAHTE_PARMAK) }));
  await tikla(dugme(sayfa, 'sertifikaAdresListesi', tr(`${P}sabitKaldir`)));
  assert.deepEqual(sertCagrilari(sayfa), [['parmakSabitlemeyiKaldir', 'ha.example.com']]);
  assert.equal(durumMetni(sayfa), tr(`${P}sabitKaldirildi`));
  assert.equal(adresMetinleri(sayfa)[1][1], tr(`${P}sabitYok`));
});

test('ayardaki adresle eşleşmeyen (adres değişmiş) sabitleme de listelenir ve kaldırılabilir', async () => {
  const sayfa = await ac({ sertifikaAdresleri: [], sertifikaSabit: [{ anaBilgisayar: 'eski.example.com', parmak: SAHTE_PARMAK }] });
  const bloklar = adresMetinleri(sayfa);
  assert.equal(sayfa.oge('sertifikaAdresListesi').children[0].textContent, tr(`${P}adresYok`));
  assert.equal(bloklar[1][0], 'eski.example.com');
  assert.equal(dugmeler(sayfa, 'sertifikaAdresListesi').length, 1, 'yalnız kaldır düğmesi (okuma/elle girme yok)');
  await tikla(dugme(sayfa, 'sertifikaAdresListesi', tr(`${P}sabitKaldir`)));
  assert.deepEqual(sertCagrilari(sayfa), [['parmakSabitlemeyiKaldir', 'eski.example.com']]);
});

test('kök sertifika ekle: liste ad, bitiş ve parmak izini gösterir; iptal hata değildir; atlanan varsa ayrı ileti; PEM sayfaya gelmez', async () => {
  const sayfa = await ac();
  await tikla(sayfa.oge('btnSertifikaCaEkle'));
  assert.deepEqual(sertCagrilari(sayfa), [['kokSertifikaEkle']]);
  assert.equal(durumMetni(sayfa), tr(`${P}caEklendi`));
  const kutu = sayfa.oge('sertifikaCaListesi').children[0];
  assert.equal(kutu.children[0].textContent, tr(`${P}caSatir`, { ad: 'Ev Kok CA', bitis: '2035-06-30' }));
  assert.equal(kutu.children[1].textContent, bicimle('cd'.repeat(32)));
  assert.equal(dugmeler(sayfa, 'sertifikaCaListesi')[0].attributes['aria-label'], tr(`${P}caKaldirEtiket`, { ad: 'Ev Kok CA' }));

  const atlanan = await ac({ kokSertifikaEkle: () => ({ ok: true, eklenen: 1, atlanan: 2 }) });
  await tikla(atlanan.oge('btnSertifikaCaEkle'));
  assert.equal(durumMetni(atlanan), tr(`${P}caEklendiAtlanan`));

  const iptal = await ac({ kokSertifikaEkle: () => ({ ok: false, iptal: true }) });
  await tikla(iptal.oge('btnSertifikaCaEkle'));
  assert.equal(durumMetni(iptal), '', 'dosya seçimi kapatıldı: ileti yok');
  assert.equal(iptal.oge('btnSertifikaCaEkle').disabled, false);
});

test('kök sertifika ekleme hataları: neden kodu ilgili iletiye çevrilir', async () => {
  for (const [neden, anahtar] of [['ozel-anahtar', 'hata.ozelAnahtar'], ['dosyada-yok', 'hata.bulunamadi'], ['ca-degil', 'hata.caDegil'], ['kok-degil', 'hata.kokDegil'], ['suresi-doldu', 'hata.suresiDoldu'], ['cok-fazla', 'hata.cokFazla'], ['yazilamadi', 'hata.yazilamadi'], ['diyalog-acilamadi', 'hata.diyalog'], ['cok-buyuk', 'hata.cokBuyuk']]) {
    const sayfa = await ac({ kokSertifikaEkle: () => ({ ok: false, neden }) });
    await tikla(sayfa.oge('btnSertifikaCaEkle'));
    assert.equal(durumMetni(sayfa), tr(P + anahtar), neden);
  }
  const kopru = await ac({
    kokSertifikaEkle: () => {
      throw new Error('ipc');
    },
  });
  await tikla(kopru.oge('btnSertifikaCaEkle'));
  assert.equal(durumMetni(kopru), tr(`${P}hata.genel`));
  assert.equal(kopru.oge('btnSertifikaCaEkle').disabled, false, 'işlem bitince düğme yeniden etkinleşir');
});

test('kök sertifika sınırı: dört kök dolunca ekle düğmesi kapanır', async () => {
  const dort = Array.from({ length: 4 }, (_, i) => ({ parmak: String(i).repeat(64), ad: `Kok ${i}`, bitis: '2035-01-01T12:00:00.000Z' }));
  const sayfa = await ac({ sertifikaCa: dort });
  assert.equal(sayfa.oge('btnSertifikaCaEkle').disabled, true);
  assert.equal(sayfa.oge('sertifikaCaListesi').children.length, 4);
});

test('kök sertifikayı kaldır: onay reddedilirse çağrı gitmez; onaylanırsa parmak izi gider ve liste güncellenir', async () => {
  const kayit = [{ parmak: 'cd'.repeat(32), ad: 'Ev Kok CA', bitis: '2035-06-30T12:00:00.000Z' }];
  const red = await acilmisSayfa({ ayar: AYAR_D3, cihazlar: CIHAZLAR_D3, onayYaniti: false, baglantiYaniti: { sertifikaCa: kayit } });
  await tikla(dugmeler(red, 'sertifikaCaListesi')[0]);
  assert.deepEqual(sertCagrilari(red), []);
  assert.deepEqual(red.sorular, [tr(`${P}caKaldirOnay`)]);

  const sayfa = await ac({ sertifikaCa: kayit });
  await tikla(dugmeler(sayfa, 'sertifikaCaListesi')[0]);
  assert.deepEqual(sertCagrilari(sayfa), [['kokSertifikayiKaldir', 'cd'.repeat(32)]]);
  assert.equal(durumMetni(sayfa), tr(`${P}caKaldirildi`));
  assert.equal(sayfa.oge('sertifikaCaListesi').children[0].textContent, tr(`${P}caYok`));
});

test('dil değişince etiketler, okunan sertifika paneli ve ileti yeni dilde yeniden yazılır; veri korunur', async () => {
  const sayfa = await ac({ sertifikaCa: [{ parmak: 'cd'.repeat(32), ad: 'Ev Kok CA', bitis: '2035-06-30T12:00:00.000Z' }] });
  await tikla(dugme(sayfa, 'sertifikaAdresListesi', tr(`${P}oku`)));
  await sayfa.dilDegisti('en');
  const en = (anahtar, d) => doldur(AYARLAR.en[anahtar], d);
  const panel = OKUNAN(sayfa).children.map((c) => c.textContent);
  assert.ok(panel.includes(en(`${P}okunanBaslik`)));
  assert.ok(panel.includes(en(`${P}okunanKonu`, { ad: 'ha.test' })));
  assert.ok(panel.includes(bicimle(SAHTE_PARMAK)), 'parmak izi dilden bağımsız');
  assert.equal(adresMetinleri(sayfa)[0][0], en(`${P}adresYerel`, { ana: '192.168.1.50:8123' }));
  assert.equal(adresMetinleri(sayfa)[0][1], en(`${P}sabitYok`));
  assert.equal(sayfa.oge('sertifikaCaListesi').children[0].children[0].textContent, en(`${P}caSatir`, { ad: 'Ev Kok CA', bitis: '2035-06-30' }));
  assert.ok(dugme(sayfa, 'sertifikaAdresListesi', en(`${P}oku`)));
  await tikla(dugme(sayfa, 'sertifikaOkunan', en(`${P}okunanSabitle`)));
  assert.equal(durumMetni(sayfa), en(`${P}sabitlendi`));
  await sayfa.dilDegisti('de');
  assert.equal(durumMetni(sayfa), doldur(AYARLAR.de[`${P}sabitlendi`]), 'ileti yeni dilde yeniden yazılır');
});

test('eşzamanlı işlem koruması: iş sürerken ikinci tıklama yok sayılır, düğmeler devre dışıdır; iş bitince açılır', async () => {
  let coz;
  const bekleyen = new Promise((r) => {
    coz = r;
  });
  const sayfa = await ac({ kokSertifikaEkle: () => bekleyen });
  sayfa.oge('btnSertifikaCaEkle').dispatchEvent({ type: 'click' });
  sayfa.oge('btnSertifikaCaEkle').dispatchEvent({ type: 'click' });
  await akit();
  assert.equal(sertCagrilari(sayfa).length, 1, 'ikinci tıklama çağrı üretmedi');
  assert.equal(sayfa.oge('btnSertifikaCaEkle').disabled, true);
  assert.ok(dugmeler(sayfa, 'sertifikaAdresListesi').every((d) => d.disabled), 'bekleyen işlemde diğer düğmeler kapalı');
  coz({ ok: true, eklenen: 1, atlanan: 0 });
  await akit();
  await akit();
  assert.equal(sayfa.oge('btnSertifikaCaEkle').disabled, false);
});

test('odak: "Elle gir" açılan parmak izi girdisine odak verir, kapatınca düğmeye döner; yeniden çizilen düğmeler odağı kaybettirmez', async () => {
  const sayfa = await ac();
  const alan = () => sayfa.oge('sertifikaAdresListesi').bul((e) => e.etiket === 'input')[0];
  const elleGir = () => dugmeler(sayfa, 'sertifikaAdresListesi').filter((d) => d.textContent === tr(`${P}elleGir`));
  elleGir()[1].focus();
  await tikla(elleGir()[1]); // dış adres
  assert.ok(alan(), 'giriş alanı açıldı');
  assert.equal(sayfa.sonOdak(), alan(), 'odak yeni parmak izi girdisinde');
  assert.equal(sayfa.sonOdak().attributes['aria-label'], tr(`${P}parmakEtiketi`));
  // girdi açıkken başka bir tazeleme (ör. dil değişimi) odağı girdide tutar
  await sayfa.dilDegisti('en');
  assert.equal(sayfa.sonOdak(), alan());
  // yeniden tıklanınca alan kapanır, odak "Elle gir" düğmesine döner
  const kapatan = dugmeler(sayfa, 'sertifikaAdresListesi').filter((d) => d.textContent === AYARLAR.en[`${P}elleGir`])[1];
  kapatan.focus();
  await tikla(kapatan);
  assert.equal(alan(), undefined);
  assert.equal(sayfa.sonOdak(), dugmeler(sayfa, 'sertifikaAdresListesi').filter((d) => d.textContent === AYARLAR.en[`${P}elleGir`])[1]);
});

test('odak: okuma, sabitleme ve vazgeçme sonrası odak aynı yerdeki (yeniden kurulan) düğmeye ya da ilgili yedeğe döner', async () => {
  const sayfa = await ac();
  const oku = () => dugmeler(sayfa, 'sertifikaAdresListesi').filter((d) => d.textContent === tr(`${P}oku`));
  const eski = oku()[1];
  eski.focus();
  await tikla(eski);
  assert.equal(OKUNAN(sayfa).style.display, '');
  assert.notEqual(oku()[1], eski, 'düğme yeniden kuruldu');
  assert.equal(sayfa.sonOdak(), oku()[1], 'okuma bitince odak (yeni) okuma düğmesinde');
  assert.equal(oku()[1].disabled, false);

  // Vazgeç: panel kapanır, odak okuma düğmesine döner
  const vazgec = dugme(sayfa, 'sertifikaOkunan', tr(`${P}okunanVazgec`));
  vazgec.focus();
  await tikla(vazgec);
  assert.equal(OKUNAN(sayfa).style.display, 'none');
  assert.equal(sayfa.sonOdak(), oku()[1]);

  // Sabitle (okunan panelinden): panel kapanır, odak o adresin "Sabitlemeyi kaldır" düğmesine geçer
  await tikla(oku()[0]);
  const sabitle = dugme(sayfa, 'sertifikaOkunan', tr(`${P}okunanSabitle`));
  sabitle.focus();
  await tikla(sabitle);
  assert.equal(durumMetni(sayfa), tr(`${P}sabitlendi`));
  assert.equal(sayfa.sonOdak(), dugme(sayfa, 'sertifikaAdresListesi', tr(`${P}sabitKaldir`)));

  // Sabitlemeyi kaldır: düğme yok olur, odak aynı adresin okuma düğmesine geçer
  const kaldir = dugme(sayfa, 'sertifikaAdresListesi', tr(`${P}sabitKaldir`));
  kaldir.focus();
  await tikla(kaldir);
  assert.equal(durumMetni(sayfa), tr(`${P}sabitKaldirildi`));
  assert.equal(dugme(sayfa, 'sertifikaAdresListesi', tr(`${P}sabitKaldir`)), undefined);
  assert.equal(sayfa.sonOdak(), oku()[0]);
});

test('odak: kök sertifika ekle/kaldır sonrası odak "Kök sertifika ekle" düğmesinde kalır; odak bölümün dışındaysa çekilmez', async () => {
  const sayfa = await ac();
  const ekle = sayfa.oge('btnSertifikaCaEkle');
  ekle.focus();
  await tikla(ekle);
  assert.equal(sayfa.oge('sertifikaCaListesi').children.length, 1);
  assert.equal(ekle.disabled, false);
  assert.equal(sayfa.sonOdak(), ekle, 'iş sürerken pasifleşen düğme odağı geri alır');

  const kaldir = dugmeler(sayfa, 'sertifikaCaListesi')[0];
  kaldir.focus();
  await tikla(kaldir);
  assert.equal(sayfa.oge('sertifikaCaListesi').children[0].textContent, tr(`${P}caYok`));
  assert.equal(sayfa.sonOdak(), ekle, 'kaldırılan satırın düğmesi yok: odak ekle düğmesine geçer');

  // kullanıcı işlem sürerken odağı başka yere taşıdıysa geri çekilmez
  let coz;
  const bekleyen = await ac({ kokSertifikaEkle: () => new Promise((c) => { coz = c; }) });
  bekleyen.oge('btnSertifikaCaEkle').focus();
  bekleyen.oge('btnSertifikaCaEkle').dispatchEvent({ type: 'click' });
  await akit();
  bekleyen.oge('btnUstbilgiEkle').focus();
  coz({ ok: true, eklenen: 1, atlanan: 0 });
  await akit();
  assert.equal(bekleyen.sonOdak(), bekleyen.oge('btnUstbilgiEkle'));
});

test('geçerlilik tarihleri YEREL güne göre yazılır (UTC+3\'te 22:30Z ertesi gündür); geçersiz tarih boş kalır', async (t) => {
  const eskiTz = process.env.TZ;
  process.env.TZ = 'Etc/GMT-3'; // UTC+3 (Türkiye)
  t.after(() => {
    if (eskiTz === undefined) delete process.env.TZ;
    else process.env.TZ = eskiTz;
  });
  if (new Date('2026-12-31T22:30:00Z').getTimezoneOffset() !== -180) return t.skip('bu ortamda çalışma anında saat dilimi değiştirilemiyor');
  const sayfa = await ac({
    sertifikaOku: (tur) => ({
      ok: true, tur, anaBilgisayar: '192.168.1.50', kapi: 8123, parmak: SAHTE_PARMAK, parmakBicimli: bicimle(SAHTE_PARMAK), ad: 'ha.test', veren: 'R3',
      sanlar: [], baslangic: '2026-12-31T22:30:00.000Z', bitis: 'bu-bir-tarih-degil', kendindenImzali: false, sistemGuveniyor: false,
    }),
    sertifikaCa: [{ parmak: 'cd'.repeat(32), ad: 'Ev Kok CA', bitis: '2026-12-31T22:30:00.000Z' }],
  });
  assert.equal(sayfa.oge('sertifikaCaListesi').children[0].children[0].textContent, tr(`${P}caSatir`, { ad: 'Ev Kok CA', bitis: '2027-01-01' }));
  await tikla(dugme(sayfa, 'sertifikaAdresListesi', tr(`${P}oku`)));
  const metinler = OKUNAN(sayfa).children.map((c) => c.textContent);
  assert.ok(metinler.includes(tr(`${P}okunanGecerlilik`, { bas: '2027-01-01', bit: '' })), 'başlangıç yerel gün, geçersiz bitiş boş');
});

test('erişilebilir adlar: yerel ve dış adres bloklarının aynı metinli düğmeleri benzersiz aria-label taşır; boş durum iletileri listitem olur', async () => {
  const sayfa = await ac({ sertifikaSabit: [{ anaBilgisayar: '192.168.1.50', parmak: SAHTE_PARMAK }, { anaBilgisayar: 'ha.example.com', parmak: SAHTE_PARMAK }] });
  const etiketler = (metin) => dugmeler(sayfa, 'sertifikaAdresListesi').filter((d) => d.textContent === metin).map((d) => d.attributes['aria-label']);
  const yerel = tr(`${P}adresYerel`, { ana: '192.168.1.50:8123' });
  const dis = tr(`${P}adresDis`, { ana: 'ha.example.com' });
  assert.deepEqual(etiketler(tr(`${P}oku`)), [tr(`${P}okuEtiket`, { ad: yerel }), tr(`${P}okuEtiket`, { ad: dis })]);
  assert.deepEqual(etiketler(tr(`${P}elleGir`)), [tr(`${P}elleGirEtiket`, { ad: yerel }), tr(`${P}elleGirEtiket`, { ad: dis })]);
  assert.deepEqual(etiketler(tr(`${P}sabitKaldir`)), [tr(`${P}sabitKaldirEtiket`, { ad: yerel }), tr(`${P}sabitKaldirEtiket`, { ad: dis })]);
  for (const metin of [tr(`${P}oku`), tr(`${P}elleGir`), tr(`${P}sabitKaldir`)]) {
    const liste = etiketler(metin);
    assert.equal(new Set(liste).size, liste.length, `${metin}: etiketler benzersiz`);
    assert.ok(liste.every((e) => e.startsWith(metin)), 'görünen metin erişilebilir adın başında (label-in-name)');
  }
  // dil değişince etiketler yeni dilde
  await sayfa.dilDegisti('en');
  assert.ok(dugmeler(sayfa, 'sertifikaAdresListesi').some((d) => d.attributes['aria-label'] === doldur(AYARLAR.en[`${P}okuEtiket`], { ad: doldur(AYARLAR.en[`${P}adresYerel`], { ana: '192.168.1.50:8123' }) })));

  // role=list kaplarındaki boş durum iletileri listitem
  const bos = await ac({ sertifikaAdresleri: [] });
  assert.equal(bos.oge('sertifikaAdresListesi').children[0].attributes.role, 'listitem');
  assert.equal(bos.oge('sertifikaCaListesi').children[0].attributes.role, 'listitem');
});

test('okunan sertifika kutusu adlı bir bölgedir (role=region + aria-label, dil değişince yenilenir) ve okuma sonucu duyurulur', async () => {
  assert.match(HTML, /id="sertifikaOkunan"[^>]*role="region"/);
  assert.match(HTML, /id="sertifikaDurum" role="status" aria-live="polite"/, 'duyuru satırı canlı bölge');
  const sayfa = await ac();
  await tikla(dugme(sayfa, 'sertifikaAdresListesi', tr(`${P}oku`)));
  assert.equal(OKUNAN(sayfa).attributes['aria-label'], tr(`${P}okunanBaslik`));
  assert.equal(durumMetni(sayfa), tr(`${P}okundu`));
  await sayfa.dilDegisti('en');
  assert.equal(OKUNAN(sayfa).attributes['aria-label'], AYARLAR.en[`${P}okunanBaslik`]);
  assert.equal(durumMetni(sayfa), AYARLAR.en[`${P}okundu`]);
  // okuma hatasında kutu açılmaz, hata iletisi yazılır
  const hata = await ac({ sertifikaOku: () => ({ ok: false, neden: 'baglanamadi' }) });
  await tikla(dugme(hata, 'sertifikaAdresListesi', tr(`${P}oku`)));
  assert.equal(durumMetni(hata), tr(`${P}hata.baglanamadi`));
});

test('Kaydet sonrası sertifika bölümü güncel adreslerle yenilenir: eski adresin okunan sertifikası ve elle girilen parmak izi başka adrese sabitlenemez', async () => {
  let durumCagrisi = 0;
  const sayfa = await ac({
    durum: (d) => {
      durumCagrisi += 1;
      return { ok: true, ustbilgi: { adlar: [], enCok: 8 }, sertifika: { ca: [], sabit: [], adresler: JSON.parse(JSON.stringify(d.sertifikaAdresleri)), enCokCa: 4 } };
    },
  });
  const okuDugmeleri = () => dugmeler(sayfa, 'sertifikaAdresListesi').filter((d) => d.textContent === tr(`${P}oku`));
  const alanlar = () => sayfa.oge('sertifikaAdresListesi').bul((e) => e.etiket === 'input');
  await tikla(okuDugmeleri()[1]); // dış adres A okunur
  assert.equal(OKUNAN(sayfa).style.display, '');
  await tikla(dugmeler(sayfa, 'sertifikaAdresListesi').filter((d) => d.textContent === tr(`${P}elleGir`))[1]);
  alanlar()[0].value = bicimle(SAHTE_PARMAK);
  alanlar()[0].dispatchEvent({ type: 'input' });
  const once = durumCagrisi;

  // kullanıcı dış adresi B yapıp Kaydet'e basar (ana süreçte ayar değişti)
  sayfa.baglantiDeposu.sertifikaAdresleri = [{ tur: 'yerel', anaBilgisayar: '192.168.1.50', kapi: 8123 }, { tur: 'dis', anaBilgisayar: 'b.example.com', kapi: 443 }];
  sayfa.oge('btnAyarlariKaydet').dispatchEvent({ type: 'click' });
  await akit();
  assert.ok(durumCagrisi > once, 'Kaydet sonrası bağlantı durumu yeniden istendi');
  assert.equal(adresMetinleri(sayfa)[1][0], tr(`${P}adresDis`, { ana: 'b.example.com' }));
  assert.equal(OKUNAN(sayfa).style.display, 'none', 'A\'nın okunan sertifikası B için sabitlenemez: kutu kapandı');
  assert.equal(alanlar().length, 0, 'A için açık elle giriş alanı kapandı');
  assert.equal(sertCagrilari(sayfa).filter((c) => c[0] === 'parmakIziniSabitle').length, 0);

  // aynı adres geri gelse bile eski taslak ve açık alan geri dönmez
  sayfa.baglantiDeposu.sertifikaAdresleri = [{ tur: 'yerel', anaBilgisayar: '192.168.1.50', kapi: 8123 }, { tur: 'dis', anaBilgisayar: 'ha.example.com', kapi: 443 }];
  sayfa.oge('btnAyarlariKaydet').dispatchEvent({ type: 'click' });
  await akit();
  assert.equal(alanlar().length, 0);

  // adres değişmediyse okunan sertifika korunur
  await tikla(okuDugmeleri()[1]);
  sayfa.oge('btnAyarlariKaydet').dispatchEvent({ type: 'click' });
  await akit();
  assert.equal(OKUNAN(sayfa).style.display, '');
});

test('İçe aktarma sonrası sertifika bölümü güncel adreslerle yenilenir: eski adresin okunan sertifikası yeni adrese sabitlenemez', async () => {
  let sayfa = null;
  sayfa = await ac({
    durum: (d) => ({ ok: true, ustbilgi: { adlar: [], enCok: 8 }, sertifika: { ca: [], sabit: [], adresler: JSON.parse(JSON.stringify(d.sertifikaAdresleri)), enCokCa: 4 } }),
  }, {
    aktarimYaniti: {
      // yedekteki dış adres başka: ana süreçteki adres listesi içe aktarmayla değişir
      icesonrasi: () => {
        sayfa.baglantiDeposu.sertifikaAdresleri = [{ tur: 'yerel', anaBilgisayar: '192.168.1.50', kapi: 8123 }, { tur: 'dis', anaBilgisayar: 'b.example.com', kapi: 443 }];
      },
    },
  });
  const okuDugmeleri = () => dugmeler(sayfa, 'sertifikaAdresListesi').filter((d) => d.textContent === tr(`${P}oku`));
  await tikla(okuDugmeleri()[1]); // dış adres A okunur
  assert.equal(OKUNAN(sayfa).style.display, '');

  sayfa.oge('btnIceAktar').dispatchEvent({ type: 'click' });
  await akit();
  assert.equal(adresMetinleri(sayfa)[1][0], tr(`${P}adresDis`, { ana: 'b.example.com' }));
  assert.equal(OKUNAN(sayfa).style.display, 'none', "A'nın okunan sertifikası B için sabitlenemez: kutu kapandı");
  assert.equal(sertCagrilari(sayfa).filter((c) => c[0] === 'parmakIziniSabitle').length, 0);
});
