'use strict';

/**
 * Ayarlar sayfasında uygulama içi güncelleme (o-51): src/ayarlar.js, sahte DOM ve sahte köprü (test/ayarlar-sahte.js).
 * Denetim/indirme/kurulum mantığı test/guncelleme.test.js'te, ana süreç bağlantısı test/ana-surec.test.js'tedir; burada yalnız sayfa davranışı sınanır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { AYAR_D3, CIHAZLAR_D3, akit, acilmisSayfa } = require('./ayarlar-sahte');

const AD = {
  kutu: 'uygulamaGuncelleme',
  onSurumler: 'onSurumler',
  indir: 'btnGuncellemeIndir',
  kur: 'btnGuncellemeKur',
  ilerleme: 'guncellemeIlerleme',
  durum: 'guncellemeDurum',
  surumDurum: 'surumDurum',
  denetle: 'btnSurumDenetle',
};
const sayfaAc = (ek = {}) => acilmisSayfa({ ayar: { ...AYAR_D3, ...(ek.ayar ?? {}) }, cihazlar: CIHAZLAR_D3, aracYaniti: ek.aracYaniti });
const tikla = async (sayfa, kimlik) => {
  sayfa.oge(kimlik).dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} });
  await akit();
};
const durumYaniti = (ek = {}) => ({ ok: true, acik: true, destek: 'tamam', durum: 'bosta', surum: null, onSurum: false, boyut: null, ilerleme: 0, hata: null, sonDenetim: null, ...ek });
const gorunur = (oge) => oge.style.display !== 'none';

test('varsayılan KAPALI: iki kutu işaretsiz, durum satırı boş, düğmeler ve ilerleme çubuğu gizli; açılışta indirme/kurma istenmez', async () => {
  const sayfa = await sayfaAc();
  assert.equal(sayfa.oge(AD.kutu).checked, false);
  assert.equal(sayfa.oge(AD.onSurumler).checked, false);
  assert.equal(sayfa.oge(AD.durum).textContent, '');
  for (const kimlik of [AD.indir, AD.kur, AD.ilerleme]) assert.equal(gorunur(sayfa.oge(kimlik)), false, kimlik);
  assert.equal(sayfa.cagrilar.some((c) => c[0] === 'guncellemeyiIndir' || c[0] === 'guncellemeyiKur'), false);
});

test('sunucudaki değerler yansır; işaretlemek formu kirli yapar; kaydedilince yükte iki alan gider', async () => {
  const acik = await sayfaAc({ ayar: { uygulamaGuncelleme: true, onSurumler: true } });
  assert.equal(acik.oge(AD.kutu).checked, true);
  assert.equal(acik.oge(AD.onSurumler).checked, true);
  const sayfa = await sayfaAc();
  sayfa.oge(AD.kutu).checked = true;
  sayfa.oge(AD.kutu).dispatchEvent({ type: 'change' });
  assert.notEqual(sayfa.oge('kirliGosterge').style.display, 'none');
  sayfa.oge(AD.onSurumler).checked = true;
  sayfa.oge(AD.onSurumler).dispatchEvent({ type: 'change' });
  await tikla(sayfa, 'btnAyarlariKaydet');
  const yuk = sayfa.cagrilar.find((c) => c[0] === 'ayarlariKaydet')[1];
  assert.equal(yuk.uygulamaGuncelleme, true);
  assert.equal(yuk.onSurumler, true);
});

test('seçenek işaretli ama henüz kaydedilmemişse "Kaydet’e basınca etkinleşir" notu görünür', async () => {
  const sayfa = await sayfaAc({ aracYaniti: { guncellemeDurumu: durumYaniti({ acik: false }) } });
  assert.equal(sayfa.oge(AD.durum).textContent, '');
  sayfa.oge(AD.kutu).checked = true;
  sayfa.oge(AD.kutu).dispatchEvent({ type: 'change' });
  assert.equal(sayfa.oge(AD.durum).textContent, 'Seçenek henüz kaydedilmedi. Kaydet’e basınca etkinleşir.');
});

test('yeni sürüm: sürüm ve boyut yazılır, yalnız "İndir" görünür; tıklayınca köprü çağrılır ve indirildikten sonra "Kur ve yeniden başlat" görünür', async () => {
  let durum = durumYaniti({ durum: 'yeni', surum: '1.4.0', boyut: 92_000_000 });
  const sayfa = await sayfaAc({
    ayar: { uygulamaGuncelleme: true },
    aracYaniti: {
      guncellemeDurumu: () => durum,
      guncellemeyiIndir: () => {
        durum = durumYaniti({ durum: 'indirildi', surum: '1.4.0', boyut: 92_000_000, ilerleme: 100 });
        return { ok: true, sonuc: 'indirildi', surum: '1.4.0' };
      },
    },
  });
  assert.equal(sayfa.oge(AD.durum).textContent, 'Yeni sürüm: 1.4.0 (88 MB). İndirmek için “İndir”e bas.');
  assert.equal(gorunur(sayfa.oge(AD.indir)), true);
  assert.equal(gorunur(sayfa.oge(AD.kur)), false);
  await tikla(sayfa, AD.indir);
  assert.equal(sayfa.cagrilar.filter((c) => c[0] === 'guncellemeyiIndir').length, 1);
  assert.equal(sayfa.oge(AD.durum).textContent, '1.4.0 indirildi ve doğrulandı. Kurmak için “Kur ve yeniden başlat”a bas; ayrıca onayın istenecek.');
  assert.equal(gorunur(sayfa.oge(AD.indir)), false);
  assert.equal(gorunur(sayfa.oge(AD.kur)), true);
});

test('indirme sürerken ilerleme çubuğu ve yüzde görünür; düğmeler kapalı; ana süreç itince canlı güncellenir', async () => {
  const sayfa = await sayfaAc({ ayar: { uygulamaGuncelleme: true }, aracYaniti: { guncellemeDurumu: durumYaniti({ durum: 'yeni', surum: '1.4.0', boyut: 5_000_000 }) } });
  await sayfa.guncellemeDegisti(durumYaniti({ durum: 'indiriliyor', surum: '1.4.0', boyut: 5_000_000, ilerleme: 42 }));
  assert.equal(sayfa.oge(AD.durum).textContent, '1.4.0 indiriliyor… %42');
  assert.equal(gorunur(sayfa.oge(AD.ilerleme)), true);
  assert.equal(Number(sayfa.oge(AD.ilerleme).value), 42);
  assert.equal(sayfa.oge(AD.indir).disabled, true);
  await sayfa.guncellemeDegisti(durumYaniti({ durum: 'indirildi', surum: '1.4.0', ilerleme: 100 }));
  assert.equal(gorunur(sayfa.oge(AD.ilerleme)), false);
  assert.equal(gorunur(sayfa.oge(AD.kur)), true);
  assert.equal(sayfa.oge(AD.kur).disabled, false);
  await sayfa.guncellemeDegisti(durumYaniti({ durum: 'kuruluyor', surum: '1.4.0', ilerleme: 100 }));
  assert.equal(sayfa.oge(AD.durum).textContent, 'Kuruluyor; uygulama birazdan kapanıp yeniden açılacak…');
  assert.equal(sayfa.oge(AD.kur).disabled, true);
  await sayfa.guncellemeDegisti({ ok: false });
  assert.equal(sayfa.oge(AD.durum).textContent, 'Kuruluyor; uygulama birazdan kapanıp yeniden açılacak…', 'geçersiz itme yok sayılır');
});

test('"Kur ve yeniden başlat": yalnız köprüyü çağırır (onay penceresini ana süreç açar); vazgeçilirse not düşer', async () => {
  const sayfa = await sayfaAc({
    ayar: { uygulamaGuncelleme: true },
    aracYaniti: { guncellemeDurumu: durumYaniti({ durum: 'indirildi', surum: '1.4.0', ilerleme: 100 }), guncellemeyiKur: { ok: true, sonuc: 'vazgecildi' } },
  });
  assert.equal(gorunur(sayfa.oge(AD.kur)), true);
  await tikla(sayfa, AD.kur);
  assert.deepEqual(sayfa.cagrilar.filter((c) => c[0] === 'guncellemeyiKur'), [['guncellemeyiKur']]);
  assert.match(sayfa.oge(AD.durum).textContent, /Kurulumdan vazgeçildi; dosya hazır/);
  assert.equal(sayfa.oge(AD.kur).disabled, false);
});

test('hata nedenleri sınıfına göre yazılır; bilinmeyen neden genel metne düşer; ham ileti/adres yazılmaz', async () => {
  const nedenler = {
    ag: 'Güncelleme sunucusuna ulaşılamadı. Bağlantını denetleyip yeniden dene.',
    zaman: 'Güncelleme sunucusu zamanında yanıt vermedi. Biraz sonra yeniden dene.',
    'dosya-yok': 'Bu sürümün güncelleme dosyası yayında bulunamadı.',
    butunluk: 'Güncelleme bilgisi geçersiz ya da eksik (sha512 yok, sürüm eski ya da dosya adı uygunsuz); hiçbir şey indirilmedi.',
    ozet: 'İndirilen dosyanın sha512 özeti yayındaki bilgiyle uyuşmadı; dosya kullanılmayacak. Yeniden indirmeyi dene.',
    imza: 'Güncelleme dosyasının imzası doğrulanamadı; kurulmayacak.',
    indirme: 'İndirme tamamlanamadı. Yeniden dene.',
    kurulum: 'Kurulum başlatılamadı. Yeniden dene; sürerse yeni kurucuyu sürüm sayfasından indir.',
    'etkin-degil': 'Güncelleyici bu çalıştırmada etkin değil.',
    'C:\\gizli\\yol https://x.example': 'Güncelleme işlemi tamamlanamadı.',
  };
  for (const [neden, beklenen] of Object.entries(nedenler)) {
    const sayfa = await sayfaAc({ ayar: { uygulamaGuncelleme: true }, aracYaniti: { guncellemeDurumu: durumYaniti({ hata: neden }) } });
    assert.equal(sayfa.oge(AD.durum).textContent, beklenen, neden);
  }
});

test('indirme hatası köprüden dönünce durum yeniden okunur ve neden yazılır', async () => {
  let durum = durumYaniti({ durum: 'yeni', surum: '1.4.0', boyut: 1_000_000 });
  const sayfa = await sayfaAc({
    ayar: { uygulamaGuncelleme: true },
    aracYaniti: {
      guncellemeDurumu: () => durum,
      guncellemeyiIndir: () => {
        durum = durumYaniti({ durum: 'yeni', surum: '1.4.0', boyut: 1_000_000, hata: 'ozet' });
        return { ok: true, sonuc: 'hata', neden: 'ozet' };
      },
    },
  });
  await tikla(sayfa, AD.indir);
  assert.match(sayfa.oge(AD.durum).textContent, /sha512 özeti yayındaki bilgiyle uyuşmadı/);
  assert.equal(gorunur(sayfa.oge(AD.indir)), true, 'yeniden denenebilir');
  const patlayan = await sayfaAc({ ayar: { uygulamaGuncelleme: true }, aracYaniti: { guncellemeDurumu: durumYaniti({ durum: 'yeni', surum: '1.4.0', boyut: 1_000_000 }), guncellemeyiIndir: () => { throw new Error('köprü koptu'); } } });
  await tikla(patlayan, AD.indir);
  assert.equal(patlayan.oge(AD.indir).disabled, false);
});

test('taşınabilir / kurulmamış / Windows dışı sürümde kutu kapalı (devre dışı) ve nedeni söylenir; düğmeler görünmez', async () => {
  const metinler = {
    tasinabilir: 'Taşınabilir sürümde uygulama içi güncelleme kullanılamaz; yeni sürümü sürüm sayfasından indir.',
    paketsiz: 'Uygulama içi güncelleme yalnızca kurulu sürümde çalışır (geliştirme çalıştırmasında etkisizdir).',
    platform: 'Uygulama içi güncelleme yalnızca Windows’ta kullanılabilir.',
  };
  for (const [destek, beklenen] of Object.entries(metinler)) {
    const sayfa = await sayfaAc({ ayar: { uygulamaGuncelleme: true }, aracYaniti: { guncellemeDurumu: durumYaniti({ destek }) } });
    assert.equal(sayfa.oge(AD.durum).textContent, beklenen, destek);
    assert.equal(sayfa.oge(AD.kutu).disabled, true);
    assert.equal(gorunur(sayfa.oge(AD.indir)) || gorunur(sayfa.oge(AD.kur)), false);
  }
  const tamam = await sayfaAc();
  assert.equal(tamam.oge(AD.kutu).disabled, false);
});

test('ön sürüm bilgisi durum satırında işaretlenir', async () => {
  const sayfa = await sayfaAc({ ayar: { uygulamaGuncelleme: true }, aracYaniti: { guncellemeDurumu: durumYaniti({ durum: 'yeni', surum: '1.5.0-beta.1', boyut: 3_000_000, onSurum: true }) } });
  assert.equal(sayfa.oge(AD.durum).textContent, 'Yeni sürüm: 1.5.0-beta.1 (2,9 MB). İndirmek için “İndir”e bas. (ön sürüm)');
});

test('"Şimdi denetle" güncelleyici etkinken yeni sürümü "aşağıdan indir" diye söyler; etkin değilken eski sürüm sayfası metni kalır', async () => {
  const etkin = await sayfaAc({ ayar: { surumDenetimi: true, uygulamaGuncelleme: true }, aracYaniti: { surumuDenetle: { ok: true, sonuc: 'yeni', surum: '1.4.0', guncelleme: true } } });
  await tikla(etkin, AD.denetle);
  assert.equal(etkin.oge(AD.surumDurum).textContent, '1.4.0 sürümü çıktı. Aşağıdaki “İndir” düğmesiyle indirebilirsin.');
  const eski = await sayfaAc({ ayar: { surumDenetimi: true }, aracYaniti: { surumuDenetle: { ok: true, sonuc: 'yeni', surum: '1.4.0' }, guncellemeDurumu: durumYaniti({ acik: false }) } });
  await tikla(eski, AD.denetle);
  assert.equal(eski.oge(AD.surumDurum).textContent, '1.4.0 sürümü çıktı. Sürüm sayfasından indirebilirsin.');
});

test('dil değişince güncelleme metinleri yeni dilde yeniden yazılır', async () => {
  const sayfa = await sayfaAc({ ayar: { uygulamaGuncelleme: true }, aracYaniti: { guncellemeDurumu: durumYaniti({ durum: 'yeni', surum: '1.4.0', boyut: 92_000_000 }) } });
  await sayfa.dilDegisti('en');
  assert.equal(sayfa.oge(AD.durum).textContent, 'New version: 1.4.0 (88 MB). Press “Download” to get it.');
  await sayfa.dilDegisti('de');
  assert.equal(sayfa.oge(AD.durum).textContent, 'Neue Version: 1.4.0 (88 MB). Klicke auf „Herunterladen“.');
  assert.equal(sayfa.oge(AD.indir).textContent, 'Herunterladen');
  assert.equal(sayfa.oge(AD.kur).textContent, 'Installieren und neu starten');
});

test('B90: güncelleme boyutunun ondalık ayracı arayüz diline uyar (tr/de/fr/es virgül, en nokta)', async () => {
  const sayfa = await sayfaAc({ ayar: { uygulamaGuncelleme: true }, aracYaniti: { guncellemeDurumu: durumYaniti({ durum: 'yeni', surum: '1.4.0', boyut: 4_400_000 }) } });
  const durum = () => sayfa.oge(AD.durum).textContent;
  assert.ok(durum().includes('(4,2 MB)'), 'tr: ' + durum());
  await sayfa.dilDegisti('en');
  assert.ok(durum().includes('(4.2 MB)'), 'en: ' + durum());
  for (const kod of ['de', 'fr', 'es']) {
    await sayfa.dilDegisti(kod);
    assert.ok(durum().includes('(4,2 MB)'), kod + ': ' + durum());
  }
  const tam = await sayfaAc({ ayar: { uygulamaGuncelleme: true }, aracYaniti: { guncellemeDurumu: durumYaniti({ durum: 'yeni', surum: '1.4.0', boyut: 92_000_000 }) } });
  assert.ok(tam.oge(AD.durum).textContent.includes('(88 MB)'), 'tam sayıda ayraç yok');
});

test('HTML: kutular etiketli, düğmeler type=button, ilerleme çubuğu var; satır içi betik ve innerHTML yok', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'ayarlar.html'), 'utf8');
  assert.match(html, /<input type="checkbox" id="uygulamaGuncelleme">/);
  assert.match(html, /<input type="checkbox" id="onSurumler">/);
  assert.match(html, /<button class="buton buton-ikincil" id="btnGuncellemeIndir" type="button"/);
  assert.match(html, /<button class="buton buton-birincil" id="btnGuncellemeKur" type="button"/);
  assert.match(html, /<progress id="guncellemeIlerleme" max="100"/);
  assert.match(html, /id="guncellemeDurum" role="status" aria-live="polite"/);
  const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'ayarlar.js'), 'utf8');
  const blok = js.slice(js.indexOf('// --- Uygulama içi güncelleme (o-51)'), js.indexOf('// --- Odadan başla (o-44)'));
  assert.ok(blok.length > 500);
  assert.doesNotMatch(blok, /innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function/);
});
