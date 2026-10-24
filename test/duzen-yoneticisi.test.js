'use strict';

/**
 * Düzen yöneticisi (src/lib/duzen-yoneticisi.js; o-16, o-24, o-28, o-30). Electron YOK: menü, onay penceresi ve geçmiş dosyası sahtedir.
 * Güvenceler: menü yalnız favori karo için açılır ve yalnız plandaki öğeleri taşır; kaldırma önce onay ister; geri yükleme şemadan
 * yeniden geçer; onarım yalnız HA'da OLMAYAN favoriyi, ana sürecin güvenli cihaz listesindeki yeni cihaza bağlar; hiçbir yol HA'ya istek atmaz.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { duzenYoneticisiOlustur, BIRLESTIR_MS } = require('../src/lib/duzen-yoneticisi');
const { duzenGecmisiOlustur } = require('../src/lib/duzen-gecmisi');
const { TR } = require('../src/lib/ceviri-varsayilan');

const fav = (kimlik, ek = {}) => ({ entity_id: kimlik, ad: kimlik.split('.')[1], ...ek });
const sayfa = (id, ad, varliklar) => ({ id, ad, varliklar });

function sahteFs() {
  const dosyalar = new Map();
  return {
    existsSync: (y) => dosyalar.has(y),
    readFileSync: (y) => dosyalar.get(y),
    statSync: (y) => ({ size: String(dosyalar.get(y)).length }),
    mkdirSync() {},
    writeFileSync: (y, v) => dosyalar.set(y, v),
    renameSync: (a, b) => {
      dosyalar.set(b, dosyalar.get(a));
      dosyalar.delete(a);
    },
  };
}

function kur({ favoriler = [fav('light.salon'), fav('scene.film'), fav('button.pc_bilgisayari_kapat', { onay: true })], sayfalar = [], onay = true, yazmaBasarili = true, cihazlar = null, karolar = null, masaustu = undefined } = {}) {
  let saat = 10_000;
  const ayarlar = { favoriler: structuredClone(favoriler), sayfalar: structuredClone(sayfalar) };
  const olaylar = { yaz: 0, degisti: [], menu: [], onaySorulari: [], duzenleAc: [], hata: [], gunluk: [], masaustuYazimlari: [] };
  const masaustuListesi = { liste: masaustu === undefined ? [] : [...masaustu] };
  const gecmis = duzenGecmisiOlustur({ dosyaYolu: 'C:\\x\\duzen-gecmisi.json', fs: sahteFs(), simdi: () => saat });
  const sahte = {
    secilecek: null, // menü kapanırken "seçilen" öğenin kimliği
    menuHatasi: false,
  };
  const karoHaritasi = karolar ?? Object.fromEntries(ayarlar.favoriler.map((f) => [f.entity_id, { id: f.entity_id, sinif: f.entity_id.startsWith('button.pc_bilgisayari') ? 'yikici' : 'zararsiz' }]));
  const y = duzenYoneticisiOlustur({
    ayarlarAl: () => ayarlar,
    yaz: () => {
      olaylar.yaz += 1;
      return yazmaBasarili;
    },
    gecmis,
    karoAl: (k) => karoHaritasi[k],
    menuAc: async (sablon) => {
      olaylar.menu.push(sablon);
      if (sahte.menuHatasi) throw new Error('HAM-HATA-METNI');
      const bul = (liste) => liste.flatMap((o) => [o, ...(o.submenu ?? [])]).find((o) => o.label === sahte.secilecek && typeof o.click === 'function');
      const oge = sahte.secilecek ? bul(sablon) : null;
      if (oge) oge.click();
    },
    onayIste: async (ad) => {
      olaylar.onaySorulari.push(ad);
      return onay;
    },
    duzenleAc: (k) => olaylar.duzenleAc.push(k),
    degisti: (s) => olaylar.degisti.push(s ?? {}),
    cihazAl: () => cihazlar,
    ...(masaustu === undefined
      ? {}
      : {
          masaustuAl: () => [...masaustuListesi.liste],
          masaustuKaydet: (liste) => {
            olaylar.masaustuYazimlari.push(liste);
            masaustuListesi.liste = [...liste];
            return yazmaBasarili;
          },
        }),
    t: TR,
    gunluk: (m) => olaylar.gunluk.push(m),
    hataBildir: (m) => olaylar.hata.push(m),
    sonraki: async () => {},
  });
  return { y, ayarlar, olaylar, gecmis, sahte, masaustuListesi, saatIlerle: (ms) => (saat += ms) };
}

const etiketler = (sablon) => sablon.flatMap((o) => [o.label ?? o.type, ...(o.submenu ?? []).map((a) => a.label)]);

test('karoMenusuAc: favori olmayan ya da modelde karosu olmayan (süzülmüş) kimlik için menü AÇILMAZ', async () => {
  const { y, olaylar } = kur({ karolar: { 'light.salon': { id: 'light.salon' } } });
  for (const kimlik of ['light.baska', 'lock.on_kapi', 5, null, undefined, 'scene.film' /* favori ama modelde karo yok */]) {
    assert.deepEqual(await y.karoMenusuAc(kimlik, {}), { ok: false }, String(kimlik));
  }
  assert.equal(olaylar.menu.length, 0);
});

test('karoMenusuAc: şablon yalnız plan öğelerini taşır (düzenle, tepsi, sayfa alt menüsü, ayraç, kaldır)', async () => {
  const { y, olaylar } = kur({ sayfalar: [sayfa('aaa', 'Akşam', []), sayfa('bbb', '', ['light.salon'])] });
  assert.deepEqual(await y.karoMenusuAc('light.salon', {}), { ok: true });
  const sablon = olaylar.menu[0];
  assert.deepEqual(etiketler(sablon), ['Düzenle…', 'Tepsiye ekle', 'Sayfaya ekle', 'Akşam', 'Sayfa 2', 'separator', 'Favorilerden kaldır…']);
  const alt = sablon.find((o) => o.submenu).submenu;
  assert.deepEqual(alt.map((a) => [a.type, a.checked]), [['checkbox', false], ['checkbox', true]]);
  // hiçbir öğe HA'ya eylem göndermez: şablon yalnız etiket + click taşır
  for (const oge of sablon) assert.deepEqual(Object.keys(oge).filter((k) => !['label', 'type', 'submenu', 'click'].includes(k)), []);
});

test('Düzenle…: Ayarlar o favoriye açılır; ayar ve geçmiş değişmez', async () => {
  const { y, olaylar, sahte, gecmis } = kur();
  sahte.secilecek = 'Düzenle…';
  await y.karoMenusuAc('light.salon', {});
  assert.deepEqual(olaylar.duzenleAc, ['light.salon']);
  assert.equal(olaylar.yaz, 0);
  assert.equal(gecmis.sayi(), 0);
  assert.equal(olaylar.degisti.length, 0);
});

test('Tepsiye ekle / Tepsiden kaldır: tepsi:true yazılır, geçmişe önceki hâl girer, yalnız model tazelenir', async () => {
  const { y, ayarlar, olaylar, sahte, gecmis } = kur();
  sahte.secilecek = 'Tepsiye ekle';
  await y.karoMenusuAc('light.salon', {});
  assert.equal(ayarlar.favoriler[0].tepsi, true);
  assert.equal(olaylar.yaz, 1);
  assert.deepEqual(olaylar.degisti, [{ yalnizModel: true }]);
  assert.equal(gecmis.sayi(), 1);
  assert.equal('tepsi' in gecmis.al(1).favoriler[0], false, 'geçmişte DEĞİŞMEDEN ÖNCEKİ hâl');
  sahte.secilecek = 'Tepsiden kaldır';
  await y.karoMenusuAc('light.salon', {});
  assert.equal('tepsi' in ayarlar.favoriler[0], false);
  assert.equal(olaylar.yaz, 2);
});

test('Sayfaya ekle: üyelik tersine çevrilir; yalnız model tazelenir', async () => {
  const { y, ayarlar, olaylar, sahte } = kur({ sayfalar: [sayfa('aaa', 'Akşam', [])] });
  sahte.secilecek = 'Akşam';
  await y.karoMenusuAc('light.salon', {});
  assert.deepEqual(ayarlar.sayfalar[0].varliklar, ['light.salon']);
  assert.deepEqual(olaylar.degisti, [{ yalnizModel: true }]);
  await y.karoMenusuAc('light.salon', {});
  assert.deepEqual(ayarlar.sayfalar[0].varliklar, [], 'ikinci seçim üyeliği kaldırır');
});

test('Favorilerden kaldır…: ÖNCE yerel onay sorulur; vazgeçilirse hiçbir şey değişmez', async () => {
  const { y, ayarlar, olaylar, sahte, gecmis } = kur({ onay: false, sayfalar: [sayfa('aaa', 'A', ['light.salon'])] });
  sahte.secilecek = 'Favorilerden kaldır…';
  await y.karoMenusuAc('light.salon', {});
  assert.deepEqual(olaylar.onaySorulari, ['salon']);
  assert.equal(ayarlar.favoriler.length, 3);
  assert.deepEqual(ayarlar.sayfalar[0].varliklar, ['light.salon']);
  assert.equal(olaylar.yaz, 0);
  assert.equal(gecmis.sayi(), 0);
  assert.equal(olaylar.degisti.length, 0);
});

test('Favorilerden kaldır…: onaylanırsa favori ve sayfa üyelikleri kalkar, geçmişe önceki düzen yazılır, izlenenler yenilenir', async () => {
  const { y, ayarlar, olaylar, sahte, gecmis } = kur({ sayfalar: [sayfa('aaa', 'A', ['light.salon', 'scene.film'])], favoriler: [fav('light.salon', { etiket: 'Salon lambası' }), fav('scene.film')] });
  sahte.secilecek = 'Favorilerden kaldır…';
  await y.karoMenusuAc('light.salon', {});
  assert.deepEqual(olaylar.onaySorulari, ['Salon lambası'], 'onay penceresinde karo adı');
  assert.deepEqual(ayarlar.favoriler.map((f) => f.entity_id), ['scene.film']);
  assert.deepEqual(ayarlar.sayfalar[0].varliklar, ['scene.film']);
  assert.deepEqual(olaylar.degisti, [{ yalnizModel: false }], 'kimlikler değişti: izlenenler yenilenir');
  const nokta = gecmis.al(1);
  assert.deepEqual(nokta.favoriler.map((f) => f.entity_id), ['light.salon', 'scene.film']);
  assert.equal(gecmis.liste()[0].neden, 'menu-kaldir');
});

test('yıkıcı favori: menüde tepsi öğesi yok; kaldırma yine onay ister (basılı tutma onayı panelde kalır, menüden eylem çalışmaz)', async () => {
  const { y, olaylar } = kur();
  await y.karoMenusuAc('button.pc_bilgisayari_kapat', {});
  assert.deepEqual(etiketler(olaylar.menu[0]), ['Düzenle…', 'separator', 'Favorilerden kaldır…']);
});

test('menü hatası ya da yazma hatası: panel çökmez; yazma başarısızsa kullanıcıya bildirilir', async () => {
  const a = kur();
  a.sahte.menuHatasi = true;
  assert.deepEqual(await a.y.karoMenusuAc('light.salon', {}), { ok: false });
  assert.equal(a.olaylar.gunluk.length, 1);
  assert.ok(!a.olaylar.gunluk[0].includes('HAM-HATA-METNI'), 'günlükte ham hata metni yok');
  const b = kur({ yazmaBasarili: false });
  b.sahte.secilecek = 'Tepsiye ekle';
  await b.y.karoMenusuAc('light.salon', {});
  assert.equal(b.olaylar.hata.length, 1);
});

test('geriDon: eski düzen şemadan yeniden geçerek yüklenir; dönmeden önceki hâl yeni nokta olur (dönüş de geri alınabilir)', () => {
  const { y, ayarlar, olaylar, gecmis, saatIlerle } = kur({ favoriler: [fav('light.a'), fav('light.b')] });
  // Geçmiş noktası ham verilir (kural sonradan sıkılaşmış ya da dosya elle düzenlenmiş gibi): geri yükleme yine süzer.
  const ham = { favoriler: [fav('light.a'), fav('lock.on_kapi'), fav('light.kapi_isigi')], sayfalar: [sayfa('aaa', 'Kapı', ['light.a', 'lock.on_kapi'])] };
  const alGercek = gecmis.al.bind(gecmis);
  gecmis.al = (id) => (id === 1 ? structuredClone(ham) : alGercek(id));
  gecmis.kaydet({ favoriler: [fav('light.a')], sayfalar: [] }, 'kaydet');
  saatIlerle(60_000);
  const r = y.geriDon(1);
  assert.deepEqual(r, { ok: true, favoriSayisi: 1, sayfaSayisi: 1, atilan: 2 });
  assert.deepEqual(ayarlar.favoriler.map((f) => f.entity_id), ['light.a'], 'kapı / kilit favorisi geri gelmez');
  assert.deepEqual(ayarlar.sayfalar, [sayfa('aaa', '', ['light.a'])]);
  assert.equal(olaylar.yaz, 1);
  assert.deepEqual(olaylar.degisti, [{ ayarlardan: true }]);
  assert.equal(gecmis.liste()[0].neden, 'don');
  assert.deepEqual(alGercek(gecmis.liste()[0].id).favoriler.map((f) => f.entity_id), ['light.a', 'light.b'], 'dönüş öncesi hâl saklandı');
});

test('geriDon: geçersiz nokta; yazma hatası', () => {
  const { y, gecmis } = kur();
  for (const kotu of [99, '1', null, undefined, 1.5]) {
    const r = y.geriDon(kotu);
    assert.equal(r.ok, false);
    assert.match(r.hata, /yok/);
  }
  gecmis.kaydet({ favoriler: [fav('light.a')], sayfalar: [] });
  const b = kur({ yazmaBasarili: false });
  b.gecmis.kaydet({ favoriler: [fav('light.a')], sayfalar: [] });
  assert.equal(b.y.geriDon(1).ok, false);
});

test('gecmisListesi: yalnız zaman, neden ve sayılar', () => {
  const { y, gecmis } = kur();
  gecmis.kaydet({ favoriler: [fav('light.a')], sayfalar: [] });
  const r = y.gecmisListesi();
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.noktalar[0]).sort(), ['favoriSayisi', 'id', 'neden', 'sayfaSayisi', 'zaman']);
});

test('sayfalarDegisti (Ayarlar\'dan sayfa kaydı): önceki sayfa listesi geçmişe girer, Ayarlar\'a bildirim gitmez; ardışık değişiklikler birleşir', () => {
  const { y, ayarlar, olaylar, gecmis, saatIlerle } = kur({ sayfalar: [sayfa('aaa', 'Yeni', [])] });
  y.sayfalarDegisti(ayarlar.sayfalar, [sayfa('aaa', 'Eski', [])]);
  assert.equal(gecmis.sayi(), 1);
  assert.equal(gecmis.al(1).sayfalar[0].ad, 'Eski');
  assert.deepEqual(olaylar.degisti, [{ yalnizModel: true, ayarlardan: true }]);
  saatIlerle(BIRLESTIR_MS - 100);
  y.sayfalarDegisti(ayarlar.sayfalar, [sayfa('aaa', 'Daha eski', [])]);
  assert.equal(gecmis.sayi(), 1, 'birleşme süresi içinde yeni nokta yok');
  saatIlerle(BIRLESTIR_MS);
  y.sayfalarDegisti(ayarlar.sayfalar, [sayfa('aaa', 'Daha eski', [])]);
  assert.equal(gecmis.sayi(), 2);
});

test('degisimiIsle: favori kaldırılınca sayfalar budanır; değişiklik yoksa geçmişe nokta eklenmez', () => {
  const { y, ayarlar, gecmis } = kur({ sayfalar: [sayfa('aaa', 'A', ['light.salon', 'scene.film'])] });
  const onceki = y.anlik();
  assert.deepEqual(y.degisimiIsle(onceki, 'kaydet'), { degisti: false, budandi: false });
  assert.equal(gecmis.sayi(), 0);
  ayarlar.favoriler = ayarlar.favoriler.filter((f) => f.entity_id !== 'light.salon');
  const r = y.degisimiIsle(onceki, 'kaydet');
  assert.deepEqual(r, { degisti: true, budandi: true });
  assert.deepEqual(ayarlar.sayfalar[0].varliklar, ['scene.film']);
  assert.equal(gecmis.sayi(), 1);
});

test('noktaAl: içe aktarma gibi çok adımlı işlemler için şimdiki düzeni nokta olarak yazar', () => {
  const { y, gecmis } = kur();
  assert.equal(y.noktaAl('aktar'), true);
  assert.equal(gecmis.liste()[0].neden, 'aktar');
});

test('onar: HA\'da OLMAYAN favori, güvenli cihaz listesindeki yeni cihaza bağlanır; ayarlar, sayfalar ve geçmiş güncellenir', () => {
  const cihazlar = { guvenli: new Map([['light.salon_yeni', 'Salon (yeni)'], ['switch.priz', 'Priz']]), tumKimlikler: new Set(['light.salon_yeni', 'switch.priz', 'scene.film']) };
  const { y, ayarlar, olaylar, gecmis } = kur({ cihazlar, favoriler: [fav('light.salon', { etiket: 'Salon', kisayol: 'Control+Alt+1' }), fav('scene.film')], sayfalar: [sayfa('aaa', 'A', ['light.salon'])] });
  const r = y.onar('light.salon', 'light.salon_yeni');
  assert.deepEqual(r, { ok: true, favoriSayisi: 2 });
  assert.deepEqual(ayarlar.favoriler.map((f) => f.entity_id), ['light.salon_yeni', 'scene.film']);
  assert.equal(ayarlar.favoriler[0].ad, 'Salon (yeni)', 'ad HA cihaz listesinden gelir');
  assert.equal(ayarlar.favoriler[0].etiket, 'Salon');
  assert.deepEqual(ayarlar.sayfalar[0].varliklar, ['light.salon_yeni']);
  assert.equal(olaylar.yaz, 1);
  assert.deepEqual(olaylar.degisti, [{ ayarlardan: true }]);
  assert.equal(gecmis.liste()[0].neden, 'onar');
});

test('onar: reddedilen durumlar — cihaz listesi yok, eski varlık HA\'da var, yeni cihaz güvenli listede değil, aynı alan değil, zaten favori', () => {
  const cihazlar = { guvenli: new Map([['light.salon_yeni', 'Yeni'], ['switch.priz', 'Priz'], ['scene.film', 'Film']]), tumKimlikler: new Set(['light.salon_yeni', 'switch.priz', 'scene.film', 'light.var', 'lock.on_kapi', 'light.kapi_isigi']) };
  const k = () => kur({ cihazlar, favoriler: [fav('light.salon'), fav('light.var'), fav('scene.film')] });
  const dene = (eski, yeni, kurulum = k()) => ({ ...kurulum.y.onar(eski, yeni), kurulum });
  assert.equal(kur({ cihazlar: null }).y.onar('light.salon', 'light.salon_yeni').neden, 'cihazlar');
  assert.equal(dene('light.salon', 5).neden, 'gecersiz');
  assert.equal(dene(5, 'light.salon_yeni').neden, 'gecersiz');
  assert.equal(dene('light.var', 'light.salon_yeni').neden, 'bulunuyor', 'çalışan favori onarılmaz');
  assert.equal(dene('light.salon', 'lock.on_kapi').neden, 'guvenlik', 'kilit güvenli listede olamaz');
  assert.equal(dene('light.salon', 'light.kapi_isigi').neden, 'guvenlik', 'kapı ışığı güvenli listede değil');
  assert.equal(dene('light.salon', 'light.hic_yok').neden, 'guvenlik', 'listede olmayan cihaz');
  assert.equal(dene('light.salon', 'switch.priz').neden, 'alan');
  assert.equal(dene('light.salon', 'scene.film').neden, 'zaten-var', 'zaten favori');
  assert.equal(dene('light.yok_ki', 'light.salon_yeni').neden, 'kayitsiz');
  const ok = dene('light.salon', 'light.salon_yeni');
  assert.equal(ok.ok, true);
  const yazilamadi = kur({ cihazlar, yazmaBasarili: false, favoriler: [fav('light.salon')] }).y.onar('light.salon', 'light.salon_yeni');
  assert.deepEqual([yazilamadi.ok, yazilamadi.neden], [false, 'yazilamadi']);
  // her hata iletisi metin olarak döner
  for (const n of ['cihazlar', 'gecersiz', 'bulunuyor', 'guvenlik', 'alan', 'kayitsiz', 'zaten-var', 'noktaYok']) assert.notEqual(TR(`duzen.hata.${n}`), `duzen.hata.${n}`, `duzen.hata.${n} Türkçe metni var`);
});

test('onar: aynı favoriye bağlı masaüstü karosu ve tepsi orta tık eylemi de yeni kimliğe taşınır; ilgisiz değerler ve tetik izinleri değişmez, karo pencereleri tazelenir', () => {
  const cihazlar = { guvenli: new Map([['light.salon_yeni', 'Salon (yeni)']]), tumKimlikler: new Set(['light.salon_yeni']) };
  const { y, ayarlar, olaylar } = kur({ cihazlar, masaustu: [], favoriler: [fav('light.salon'), fav('light.baska')] });
  ayarlar.masaustuKarolari = ['light.salon', 'light.baska'];
  ayarlar.tepsiOrtaTik = 'light.salon';
  ayarlar.tetikProtokolIzinleri = { 'light.salon': 'her-zaman' };
  assert.equal(y.onar('light.salon', 'light.salon_yeni').ok, true);
  assert.deepEqual(ayarlar.masaustuKarolari, ['light.salon_yeni', 'light.baska']);
  assert.equal(ayarlar.tepsiOrtaTik, 'light.salon_yeni');
  assert.deepEqual(ayarlar.tetikProtokolIzinleri, { 'light.salon': 'her-zaman' }, 'tetik izni yeni kimliğe taşınmaz');
  assert.deepEqual(olaylar.masaustuYazimlari, [['light.salon_yeni', 'light.baska']], 'masaüstü karoları eşitlenir');

  // ilgisiz değerler aynen kalır
  const baska = kur({ cihazlar, masaustu: [], favoriler: [fav('light.salon'), fav('light.baska')] });
  baska.ayarlar.masaustuKarolari = ['light.baska'];
  baska.ayarlar.tepsiOrtaTik = 'light.baska';
  assert.equal(baska.y.onar('light.salon', 'light.salon_yeni').ok, true);
  assert.deepEqual(baska.ayarlar.masaustuKarolari, ['light.baska']);
  assert.equal(baska.ayarlar.tepsiOrtaTik, 'light.baska');
  assert.deepEqual(baska.olaylar.masaustuYazimlari, []);

  // reddedilen onarımda ikisi de aynen kalır
  const red = kur({ cihazlar: { guvenli: new Map(), tumKimlikler: new Set() }, masaustu: [], favoriler: [fav('light.salon')] });
  red.ayarlar.masaustuKarolari = ['light.salon'];
  red.ayarlar.tepsiOrtaTik = 'light.salon';
  assert.equal(red.y.onar('light.salon', 'light.salon_yeni').ok, false);
  assert.deepEqual(red.ayarlar.masaustuKarolari, ['light.salon']);
  assert.equal(red.ayarlar.tepsiOrtaTik, 'light.salon');
  assert.deepEqual(red.olaylar.masaustuYazimlari, []);
});

// --- masaüstüne sabitle (1.4.0) -------------------------------------------------------------------------------------------

test('Masaüstüne sabitle: menüde tepsiden sonra görünür; seçilince yalnız sabitli liste yazılır (favori / sayfa / geçmiş değişmez), model tazelenir', async () => {
  const { y, ayarlar, olaylar, sahte, gecmis, masaustuListesi } = kur({ masaustu: ['scene.film'] });
  await y.karoMenusuAc('light.salon', {});
  assert.deepEqual(etiketler(olaylar.menu[0]), ['Düzenle…', 'Tepsiye ekle', 'Masaüstüne sabitle', 'separator', 'Favorilerden kaldır…']);
  const once = JSON.stringify(ayarlar);
  sahte.secilecek = 'Masaüstüne sabitle';
  await y.karoMenusuAc('light.salon', {});
  assert.deepEqual(masaustuListesi.liste, ['scene.film', 'light.salon']);
  assert.deepEqual(olaylar.masaustuYazimlari, [['scene.film', 'light.salon']]);
  assert.equal(JSON.stringify(ayarlar), once, 'favoriler ve sayfalar değişmez');
  assert.equal(gecmis.sayi(), 0, 'masaüstü sabitlemesi düzen geçmişine girmez');
  assert.equal(olaylar.yaz, 0, 'favori / sayfa yazımı yok; sabitli listeyi yazmak masaustuKaydet\'in işi');
  assert.deepEqual(olaylar.degisti, [{ yalnizModel: true }]);
  assert.equal(olaylar.hata.length, 0);
});

test('Sabitlemeyi kaldır: sabitli karoda etiket değişir ve seçilince liste kısalır; ikinci seçim yeniden sabitler', async () => {
  const { y, olaylar, sahte, masaustuListesi } = kur({ masaustu: ['light.salon'] });
  await y.karoMenusuAc('light.salon', {});
  assert.ok(etiketler(olaylar.menu[0]).includes('Sabitlemeyi kaldır'));
  sahte.secilecek = 'Sabitlemeyi kaldır';
  await y.karoMenusuAc('light.salon', {});
  assert.deepEqual(masaustuListesi.liste, []);
  sahte.secilecek = 'Masaüstüne sabitle';
  await y.karoMenusuAc('light.salon', {});
  assert.deepEqual(masaustuListesi.liste, ['light.salon']);
});

test('Masaüstüne sabitle: yıkıcı favori, sabitlenemeyen alan ve dolu liste için menüde öğe yok; liste desteği verilmeyen yöneticide hiç çıkmaz', async () => {
  const dolu = ['light.k0', 'light.k1', 'light.k2', 'light.k3', 'light.k4', 'light.k5'];
  const a = kur({ masaustu: [] });
  await a.y.karoMenusuAc('button.pc_bilgisayari_kapat', {});
  assert.ok(!etiketler(a.olaylar.menu[0]).includes('Masaüstüne sabitle'), 'yıkıcı karo');
  const b = kur({ masaustu: dolu });
  await b.y.karoMenusuAc('light.salon', {});
  assert.ok(!etiketler(b.olaylar.menu[0]).includes('Masaüstüne sabitle'), 'liste dolu');
  const c = kur({ favoriler: [fav('climate.salon')], karolar: { 'climate.salon': { id: 'climate.salon', sinif: 'zararsiz', varsayilanEylem: false } }, masaustu: [] });
  await c.y.karoMenusuAc('climate.salon', {});
  assert.ok(!etiketler(c.olaylar.menu[0]).includes('Masaüstüne sabitle'), 'klima sabitlenemez');
  const d = kur();
  await d.y.karoMenusuAc('light.salon', {});
  assert.ok(!etiketler(d.olaylar.menu[0]).includes('Masaüstüne sabitle'), 'masaustuAl verilmemiş');
});

test('Masaüstüne sabitle: yazma başarısızsa kullanıcıya bildirilir ve panel çökmez', async () => {
  const { y, olaylar, sahte } = kur({ masaustu: [], yazmaBasarili: false });
  sahte.secilecek = 'Masaüstüne sabitle';
  assert.deepEqual(await y.karoMenusuAc('light.salon', {}), { ok: true });
  assert.equal(olaylar.hata.length, 1);
});
