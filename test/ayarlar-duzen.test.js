'use strict';

/**
 * Ayarlar > düzen bölümü (src/ayarlar-duzen.js; 1.4.0 düzen grubu): karo görünümü (o-31, o-16 tepsiye sabitle), sıra sürükle-bırak ve
 * Alt+ok (o-30), panel sayfaları (o-24), düzen geçmişi (o-30), kullanılamayan favoriyi onarma (o-28) ve panel menüsünden "Düzenle…" odağı.
 * Gerçek tarayıcı / Electron / Home Assistant YOK: sahte DOM ve sahte köprü (test/ayarlar-sahte.js).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const AYARLAR = require('../src/lib/ceviri/ayarlar');
const ANA = require('../src/lib/ceviri/ana');
const { DUZEN_BETIK, AYAR_D3, CIHAZLAR_D3, akit, duzles, acilmisSayfa, satirBul, girdiler, sira, siraMetni, tusOlayi, gorunurMetinler } = require('./ayarlar-sahte');

const TURKCE_HARF = /[çğıöşüÇĞİÖŞÜ]/;
const metin = (anahtar, degiskenler = {}, dil = 'tr') =>
  (AYARLAR[dil][anahtar] ?? ANA[dil][anahtar]).replace(/\{([A-Za-z0-9_]+)\}/g, (_, ad) => String(degiskenler[ad]));

const kaydet = async (sayfa) => {
  sayfa.oge('btnAyarlariKaydet').dispatchEvent({ type: 'click' });
  await akit();
};
const sonYuk = (sayfa, ad = 'ayarlariKaydet') => duzles(sayfa.cagrilar.filter((c) => c[0] === ad).at(-1)[1]);
const cagriSayisi = (sayfa, ad) => sayfa.cagrilar.filter((c) => c[0] === ad).length;
const kirliMi = (sayfa) => sayfa.oge('kirliGosterge').style.display !== 'none';
const bildirim = (sayfa) => sayfa.oge('genelBildirim').textContent;
const duyuru = (sayfa) => sayfa.oge('duzenDuyuru').textContent.replace(/​/g, '');
const secimler = (satir) => satir.bul((o) => o.etiket === 'select');
const degistir = (oge, deger) => {
  oge.value = deger;
  oge.dispatchEvent({ type: 'change' });
};
const yaz = (oge, deger) => {
  oge.value = deger;
  oge.dispatchEvent({ type: 'input' });
};
const tepsiKutusu = (satir) => girdiler(satir).filter((g) => g.type === 'checkbox').at(-1);
const emojiKutusu = (satir) => satir.bul((o) => o.className.split(' ').includes('gorunum-emoji'))[0];
const sirali = (sayfa) => sira(sayfa).map(siraMetni);
const sayfaSatirlari = (sayfa) => sayfa.oge('sayfalarListesi').bul((o) => o.className === 'sayfa-satir');
const etiketle = (kok, desen) => kok.bul((o) => o.etiket === 'button' && desen.test(o.attributes['aria-label'] ?? ''))[0];
const dugmeMetni = (kok, yazi) => kok.bul((o) => o.etiket === 'button' && o.textContent === yazi)[0];

// Panel sayfalarında ve sıralamada kullanılan üç favori (hepsi seçili): ışık, sahne ve gizli ama seçili ışık.
const AYAR_DUZEN = {
  ...AYAR_D3,
  sayfalar: [],
  favoriler: [
    { entity_id: 'light.salon_lambasi', ad: 'Salon Lambası' },
    { entity_id: 'scene.film', ad: 'Film' },
    { entity_id: 'light.gizli_ama_secili', ad: 'Seçili Gizli' },
  ],
};

const duzenSayfasi = (ek = {}) => acilmisSayfa({ ayar: AYAR_DUZEN, cihazlar: CIHAZLAR_D3, ...ek });

// ---------------------------------------------------------------- saf yardımcılar

function yardimcilar() {
  const sandbox = { window: null };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'lib', 'karo-gorunum.js'), 'utf8'), sandbox);
  vm.runInContext(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'lib', 'duzen-islemleri.js'), 'utf8'), sandbox);
  vm.runInContext(DUZEN_BETIK, sandbox);
  return sandbox.EvAyarlarDuzen;
}

test('saf yardımcılar: sayfa normalleştirme, sürükleme hedefi, simge seçimi', () => {
  const D = yardimcilar();
  const duz = (x) => JSON.parse(JSON.stringify(x));
  assert.deepEqual(duz(D.sayfalariNormallestir(undefined)), []);
  assert.deepEqual(
    duz(D.sayfalariNormallestir([{ id: 'abc12', ad: '  Salon   Sayfası ', varliklar: ['a', 'a', '', 5, 'b'] }, null, { ad: 'kimliksiz' }, 'x'])),
    [{ id: 'abc12', ad: 'Salon Sayfası', varliklar: ['a', 'b'] }],
    'boşluklar sadeleşir, tekrarlar ve geçersiz varlıklar düşer, kimliksiz sayfa atılır',
  );
  assert.equal(D.sayfalariNormallestir([{ id: 'abc12', ad: 'x'.repeat(40), varliklar: [] }])[0].ad.length, 24, 'ad 24 karaktere kırpılır');

  const liste = ['a', 'b', 'c', 'd'];
  assert.equal(D.suruklemeHedefi(liste, 'a', 'c', false), 1, 'a, c’nin önüne: [b, a, c, d]');
  assert.equal(D.suruklemeHedefi(liste, 'a', 'c', true), 2, 'a, c’nin arkasına: [b, c, a, d]');
  assert.equal(D.suruklemeHedefi(liste, 'd', 'b', false), 1, 'd, b’nin önüne: [a, d, b, c]');
  assert.equal(D.suruklemeHedefi(liste, 'd', 'b', true), 2);
  assert.equal(D.suruklemeHedefi(liste, 'a', 'yok', false), -1, 'bilinmeyen hedef');
  assert.equal(D.suruklemeHedefi(liste, 'yok', 'a', false), -1, 'bilinmeyen kaynak');

  assert.equal(D.simgeSecimi(''), '');
  assert.equal(D.simgeSecimi(undefined), '');
  assert.equal(D.simgeSecimi('ikon:isik'), 'ikon:isik');
  assert.equal(D.simgeSecimi('ikon:yok_boyle_ikon'), 'emoji', 'bilinmeyen ikon seçili kalmasın: emoji kutusuna düşer (orada doğrulanır)');
  assert.equal(D.simgeSecimi('🌙'), 'emoji');
  assert.equal(typeof D.zamanMetni(Date.UTC(2026, 9, 15, 10, 30), 'tr'), 'string');
});

// ---------------------------------------------------------------- karo görünümü (o-31, o-16)

test('karo görünümü: her normal satırda simge / renk / boyut / tepsiye sabitle; seçilmeyen satırda pasif; varsayılanlar ve kirli durum', async () => {
  const sayfa = await duzenSayfasi();
  const isik = satirBul(sayfa, 'light.salon_lambasi');
  const [renk, boyut, simge] = secimler(isik);
  assert.equal(renk.value, '');
  assert.equal(boyut.value, 'normal');
  assert.equal(simge.value, '');
  assert.equal(tepsiKutusu(isik).checked, false);
  assert.equal(emojiKutusu(isik).style.display, 'none', 'emoji kutusu yalnız "Emoji…" seçilince görünür');
  assert.ok(isik.bul((o) => o.className === 'gorunum-grubu').length === 1);
  assert.equal(kirliMi(sayfa), false);

  // seçeneklerin metinleri sözlükten gelir ve bilinen paletle sınırlıdır
  assert.deepEqual(renk.children.map((o) => o.value), ['', 'kirmizi', 'turuncu', 'sari', 'yesil', 'turkuaz', 'mavi', 'mor', 'pembe', 'gri']);
  assert.deepEqual(boyut.children.map((o) => o.value), ['kucuk', 'normal', 'genis', 'buyuk']);
  assert.equal(simge.children[0].textContent, metin('ayar.gorunum.simgeYok'));
  assert.equal(simge.children.at(-1).value, 'emoji');
  assert.ok(simge.children.some((o) => o.value === 'ikon:isik'));

  // seçilmemiş satır (sahne seçili ama "button.pc_bilgisayari_kapat" değil): kontroller pasif
  const secilmeyen = satirBul(sayfa, 'button.pc_bilgisayari_kapat');
  assert.ok(secimler(secilmeyen).every((s) => s.disabled), 'seçilmemiş satırda pasif');
  assert.equal(tepsiKutusu(secilmeyen).disabled, true);
  girdiler(secilmeyen)[0].tikla(); // seç
  assert.ok(secimler(secilmeyen).every((s) => !s.disabled), 'seçilince açılır');

  // değiştir -> kirli; eski değere dön -> temiz
  degistir(renk, 'mavi');
  assert.equal(kirliMi(sayfa), true);
  degistir(renk, '');
  assert.equal(kirliMi(sayfa), true, 'bu satırın seçimi (button) hâlâ değişti');
  girdiler(secilmeyen)[0].tikla(); // seçimi geri al
  assert.equal(kirliMi(sayfa), false, 'geri alınan görünüm düzenlemesi kirli sayılmaz');
});

test('karo görünümü kaydı: yük YALNIZ değişen alanları taşır; sunucu değerleri satıra döner; değişiklik yoksa favori çağrısı yapılmaz', async () => {
  const sayfa = await duzenSayfasi();
  await kaydet(sayfa);
  assert.equal(cagriSayisi(sayfa, 'favorileriKaydet'), 0, 'dokunulmadı: favori çağrısı yok');

  const isik = satirBul(sayfa, 'light.salon_lambasi');
  const [renk, boyut, simge] = secimler(isik);
  degistir(renk, 'mavi');
  degistir(boyut, 'genis');
  degistir(simge, 'ikon:isik');
  tepsiKutusu(isik).tikla();
  assert.equal(kirliMi(sayfa), true);
  await kaydet(sayfa);

  const yuk = new Map(sonYuk(sayfa, 'favorileriKaydet').map((g) => [g.entity_id, g]));
  assert.deepEqual(yuk.get('light.salon_lambasi'), { entity_id: 'light.salon_lambasi', renk: 'mavi', boyut: 'genis', simge: 'ikon:isik', tepsi: true });
  assert.deepEqual(yuk.get('scene.film'), { entity_id: 'scene.film' }, 'dokunulmayan favoriye görünüm alanı eklenmez');
  assert.equal(kirliMi(sayfa), false, 'kayıttan sonra temiz');
  const kayitli = sayfa.sunucu.favoriler.find((f) => f.entity_id === 'light.salon_lambasi');
  assert.deepEqual([kayitli.renk, kayitli.boyut, kayitli.simge, kayitli.tepsi], ['mavi', 'genis', 'ikon:isik', true]);

  // satır sunucudaki değerlerle yeniden kurulur
  const yeni = satirBul(sayfa, 'light.salon_lambasi');
  const [renk2, boyut2, simge2] = secimler(yeni);
  assert.deepEqual([renk2.value, boyut2.value, simge2.value, tepsiKutusu(yeni).checked], ['mavi', 'genis', 'ikon:isik', true]);

  // temizleme: '' / normal / false gönderilir (ana süreç kaydı siler)
  degistir(renk2, '');
  degistir(boyut2, 'normal');
  degistir(simge2, '');
  tepsiKutusu(yeni).tikla();
  await kaydet(sayfa);
  assert.deepEqual(new Map(sonYuk(sayfa, 'favorileriKaydet').map((g) => [g.entity_id, g])).get('light.salon_lambasi'),
    { entity_id: 'light.salon_lambasi', renk: '', boyut: 'normal', simge: '', tepsi: false });
  const temiz = sayfa.sunucu.favoriler.find((f) => f.entity_id === 'light.salon_lambasi');
  assert.deepEqual(Object.keys(temiz).sort(), ['ad', 'entity_id']);
});

const SENSOR_CIHAZI = { entity_id: 'sensor.guc', ad: 'Güç', alan: 'sensor', alanEtiketi: 'Sensörler', durum: '350', onayZorunlu: false, varsayilanOnay: false, kisayolUygun: false, tekTiklama: false, gizli: false };
const sensorSayfasi = (favori = {}) =>
  acilmisSayfa({
    ayar: { ...AYAR_DUZEN, favoriler: [...AYAR_DUZEN.favoriler, { entity_id: 'sensor.guc', ad: 'Güç', ...favori }] },
    cihazlar: { ...CIHAZLAR_D3, cihazlar: [...CIHAZLAR_D3.cihazlar, SENSOR_CIHAZI] },
  });
const sayiKutulari = (satir) => girdiler(satir).filter((g) => g.type === 'number');

test('sensör favorisi: grafik biçimi seçici ve gösterge alt / üst kutuları yalnız sensör satırında; kayıttaki değerler gösterilir, açılışta kirli sayılmaz', async () => {
  const sayfa = await sensorSayfasi({ gostergeMin: 0, gostergeMax: 500, grafikTuru: 'gosterge' });
  const satir = satirBul(sayfa, 'sensor.guc');
  const [renk, boyut, simge, grafik] = secimler(satir);
  assert.deepEqual(grafik.children.map((o) => o.value), ['otomatik', 'cizgi', 'gosterge', 'yok']);
  assert.deepEqual(grafik.children.map((o) => o.textContent), ['Otomatik', 'Çizgi', 'Gösterge', 'Yok']);
  assert.equal(grafik.value, 'gosterge');
  assert.equal(grafik.attributes['aria-label'], 'Güç grafik biçimi');
  assert.deepEqual(sayiKutulari(satir).map((k) => k.value), ['0', '500']);
  assert.deepEqual(sayiKutulari(satir).map((k) => k.attributes['aria-label']), ['Güç gösterge alt değeri', 'Güç gösterge üst değeri']);
  assert.equal(kirliMi(sayfa), false);
  // sensör olmayan satırda bu kontroller yok
  const isik = satirBul(sayfa, 'light.salon_lambasi');
  assert.equal(secimler(isik).length, 3);
  assert.equal(sayiKutulari(isik).length, 0);
  assert.ok([renk, boyut, simge].every((s) => !s.disabled));
  await kaydet(sayfa);
  assert.equal(cagriSayisi(sayfa, 'favorileriKaydet'), 0);
});

test('sensör favorisi kaydı: grafik biçimi ve aralık yüke girer (aralık ÇİFT), temizlemek null gönderir; geçersiz çift kayda alınmaz', async () => {
  const sayfa = await sensorSayfasi();
  const satir = satirBul(sayfa, 'sensor.guc');
  const [alt, ust] = sayiKutulari(satir);
  const hata = satir.bul((o) => o.className === 'cihaz-not' && o.textContent === metin('ayar.gorunum.gostergeGecersiz'))[0];
  assert.equal(hata.style.display, 'none');

  yaz(alt, '10'); // tek sınır: geçersiz çift
  assert.equal(hata.style.display, 'block');
  assert.equal(alt.attributes['aria-invalid'], 'true');
  assert.equal(kirliMi(sayfa), false, 'geçersiz çift kayda alınmaz');
  yaz(ust, '5'); // ters aralık
  assert.equal(hata.style.display, 'block');
  assert.equal(kirliMi(sayfa), false);
  yaz(ust, '90');
  assert.equal(hata.style.display, 'none');
  assert.equal(alt.attributes['aria-invalid'], undefined);
  assert.equal(kirliMi(sayfa), true);
  degistir(secimler(satir)[3], 'cizgi');
  await kaydet(sayfa);
  assert.deepEqual(new Map(sonYuk(sayfa, 'favorileriKaydet').map((g) => [g.entity_id, g])).get('sensor.guc'), {
    entity_id: 'sensor.guc',
    grafikTuru: 'cizgi',
    gostergeMin: 10,
    gostergeMax: 90,
  });
  const kayitli = sayfa.sunucu.favoriler.find((f) => f.entity_id === 'sensor.guc');
  assert.deepEqual([kayitli.gostergeMin, kayitli.gostergeMax, kayitli.grafikTuru], [10, 90, 'cizgi']);

  // yalnız alt sınır değişir: yük ikisini birlikte taşır
  const yeni = satirBul(sayfa, 'sensor.guc');
  const [alt2, ust2] = sayiKutulari(yeni);
  assert.deepEqual([alt2.value, ust2.value], ['10', '90']);
  yaz(alt2, '20');
  await kaydet(sayfa);
  assert.deepEqual(new Map(sonYuk(sayfa, 'favorileriKaydet').map((g) => [g.entity_id, g])).get('sensor.guc'), { entity_id: 'sensor.guc', gostergeMin: 20, gostergeMax: 90 });

  // ikisini de boşaltmak aralığı temizler (null), "otomatik" biçim kayda yazılmaz
  const son = satirBul(sayfa, 'sensor.guc');
  const [alt3, ust3] = sayiKutulari(son);
  yaz(alt3, '');
  yaz(ust3, '');
  degistir(secimler(son)[3], 'otomatik');
  await kaydet(sayfa);
  assert.deepEqual(new Map(sonYuk(sayfa, 'favorileriKaydet').map((g) => [g.entity_id, g])).get('sensor.guc'), { entity_id: 'sensor.guc', grafikTuru: 'otomatik', gostergeMin: null, gostergeMax: null });
  const temiz = sayfa.sunucu.favoriler.find((f) => f.entity_id === 'sensor.guc');
  assert.deepEqual(Object.keys(temiz).sort(), ['ad', 'entity_id']);
});

test('sensör favorisi: seçili değilken kontroller pasif, seçilince açılır', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR_DUZEN, cihazlar: { ...CIHAZLAR_D3, cihazlar: [...CIHAZLAR_D3.cihazlar, SENSOR_CIHAZI] } });
  const satir = satirBul(sayfa, 'sensor.guc');
  assert.ok(secimler(satir).every((s) => s.disabled));
  assert.ok(sayiKutulari(satir).every((k) => k.disabled));
  girdiler(satir)[0].tikla();
  assert.ok(secimler(satir).every((s) => !s.disabled));
  assert.ok(sayiKutulari(satir).every((k) => !k.disabled));
});

test('karo görünümü: ayardaki değerler satırda gösterilir (emoji dahil) ve açılışta kirli sayılmaz', async () => {
  const ayar = { ...AYAR_DUZEN, favoriler: [{ entity_id: 'light.salon_lambasi', ad: 'Salon Lambası', simge: '🌙', renk: 'mor', boyut: 'buyuk', tepsi: true }, ...AYAR_DUZEN.favoriler.slice(1)] };
  const sayfa = await acilmisSayfa({ ayar, cihazlar: CIHAZLAR_D3 });
  const isik = satirBul(sayfa, 'light.salon_lambasi');
  const [renk, boyut, simge] = secimler(isik);
  assert.deepEqual([renk.value, boyut.value, simge.value, tepsiKutusu(isik).checked], ['mor', 'buyuk', 'emoji', true]);
  assert.equal(emojiKutusu(isik).value, '🌙');
  assert.equal(emojiKutusu(isik).style.display, '');
  assert.equal(kirliMi(sayfa), false);
  await kaydet(sayfa);
  assert.equal(cagriSayisi(sayfa, 'favorileriKaydet'), 0);
});

test('emoji simgesi: geçerli emoji kaydedilir; kapı / kilit emojisi ve düz metin reddedilir (işaretlenir, kayda girmez); boş = simgeyi temizle', async () => {
  const sayfa = await duzenSayfasi();
  const isik = satirBul(sayfa, 'light.salon_lambasi');
  const simge = secimler(isik)[2];
  degistir(simge, 'emoji');
  const emoji = emojiKutusu(isik);
  assert.equal(emoji.style.display, '', 'seçilince görünür');
  assert.equal(kirliMi(sayfa), false, 'henüz boş: değişiklik yok');

  yaz(emoji, '🚪');
  assert.equal(emoji.attributes['aria-invalid'], 'true', 'kapı emojisi geçersiz');
  assert.ok(emoji.className.includes('gecersiz'));
  assert.equal(kirliMi(sayfa), false, 'geçersiz değer kayda alınmaz');
  yaz(emoji, '🔒');
  assert.equal(emoji.attributes['aria-invalid'], 'true');
  yaz(emoji, 'abc');
  assert.equal(emoji.attributes['aria-invalid'], 'true', 'düz metin emoji değildir');
  const hataNotu = isik.bul((o) => o.className === 'cihaz-not' && o.textContent === metin('ayar.gorunum.emojiGecersiz'))[0];
  assert.equal(hataNotu.style.display, 'block');
  await kaydet(sayfa);
  assert.equal(cagriSayisi(sayfa, 'favorileriKaydet'), 0, 'geçersiz emoji sunucuya gitmez');

  yaz(emoji, '🌙');
  assert.equal(emoji.attributes['aria-invalid'], undefined);
  assert.equal(hataNotu.style.display, 'none');
  assert.equal(kirliMi(sayfa), true);
  await kaydet(sayfa);
  assert.equal(new Map(sonYuk(sayfa, 'favorileriKaydet').map((g) => [g.entity_id, g])).get('light.salon_lambasi').simge, '🌙');

  // boşaltmak simgeyi temizler
  const yeni = satirBul(sayfa, 'light.salon_lambasi');
  yaz(emojiKutusu(yeni), '');
  await kaydet(sayfa);
  assert.equal(new Map(sonYuk(sayfa, 'favorileriKaydet').map((g) => [g.entity_id, g])).get('light.salon_lambasi').simge, '');

  // çizgi ikona geri dönmek emoji kutusunu gizler
  const yeni2 = satirBul(sayfa, 'light.salon_lambasi');
  degistir(secimler(yeni2)[2], 'emoji');
  degistir(secimler(yeni2)[2], 'ikon:ev');
  assert.equal(emojiKutusu(yeni2).style.display, 'none');
});

test('görünüm reddi: sunucu bir görünümü kabul etmezse kullanıcıya söylenir (sessiz kalmaz) ve önceki değer korunur', async () => {
  const sayfa = await duzenSayfasi({
    favoriSonucu: { ok: true, sayi: 3, eksik: 0, engelli: 0, gorunumHatalari: [{ entity_id: 'light.salon_lambasi', alan: 'renk' }] },
  });
  degistir(secimler(satirBul(sayfa, 'light.salon_lambasi'))[0], 'mavi');
  await kaydet(sayfa);
  assert.ok(bildirim(sayfa).includes(metin('ayar.kaydet.gorunumRed.bir', { n: 1 })), bildirim(sayfa));
  assert.match(sayfa.oge('genelBildirim').className, /bildirim-uyari/);
});

// ---------------------------------------------------------------- sıra: sürükle-bırak ve Alt+ok (o-30)

const surukle = (sayfa, kaynak, hedef, { sonra }) => {
  const veri = {};
  const dt = { effectAllowed: '', dropEffect: '', setData(tur, deger) { veri[tur] = deger; } };
  const satirlar = sira(sayfa);
  satirlar[kaynak].dispatchEvent({ type: 'dragstart', dataTransfer: dt });
  const hedefSatir = satirlar[hedef];
  hedefSatir.getBoundingClientRect = () => ({ top: 100, height: 20 });
  const olay = { type: 'dragover', clientY: sonra ? 115 : 105, dataTransfer: dt, onlendi: false, preventDefault() { this.onlendi = true; } };
  hedefSatir.dispatchEvent(olay);
  hedefSatir.dispatchEvent({ type: 'drop', clientY: sonra ? 115 : 105, dataTransfer: dt, preventDefault() {} });
  return { veri, olay, hedefSatir };
};

test('sıra: satırlar sürüklenebilir (yalnız cihaz listesi yüklüyken); bırakılan yere taşınır, kirli olur, kayıtta yeni sırayla gider', async () => {
  const sayfa = await duzenSayfasi();
  assert.deepEqual(sirali(sayfa), ['Salon Lambası', 'Film', 'Seçili Gizli']);
  const ilk = sira(sayfa)[0];
  assert.equal(ilk.attributes.draggable, 'true');
  assert.ok(ilk.bul((o) => o.className === 'sira-tutamac').length === 1, 'tutamak var');
  assert.equal(ilk.bul((o) => o.className === 'sira-tutamac')[0].attributes['aria-hidden'], 'true', 'tutamak süstür: klavye yolu ↑ ↓ ve Alt+ok');
  assert.equal(ilk.className, 'sira-satir', 'sınıf adı sürüklemeden önce sade kalır');

  // ilk satırı sonuncunun ARKASINA bırak
  const { veri, olay } = surukle(sayfa, 0, 2, { sonra: true });
  assert.equal(olay.onlendi, true, 'dragover bırakmaya izin verir');
  assert.deepEqual(Object.keys(veri), ['application/x-ev-paneli-sira'], 'yalnız uygulamanın kendi sürükleme türü yazılır');
  assert.deepEqual(sirali(sayfa), ['Film', 'Seçili Gizli', 'Salon Lambası']);
  assert.equal(kirliMi(sayfa), true);
  assert.ok(sira(sayfa).every((s) => s.className === 'sira-satir'), 'sürükleme işaretleri temizlenir');
  assert.match(duyuru(sayfa), /Salon Lambası/);
  assert.match(duyuru(sayfa), /3/);

  // son satırı ilkin ÖNÜNE bırak
  surukle(sayfa, 2, 0, { sonra: false });
  assert.deepEqual(sirali(sayfa), ['Salon Lambası', 'Film', 'Seçili Gizli']);
  assert.equal(kirliMi(sayfa), false, 'ilk sıraya dönüldü: kirli değil');

  surukle(sayfa, 1, 2, { sonra: true });
  assert.deepEqual(sirali(sayfa), ['Salon Lambası', 'Seçili Gizli', 'Film']);
  await kaydet(sayfa);
  assert.deepEqual(sonYuk(sayfa, 'favorileriKaydet').map((g) => g.entity_id), ['light.salon_lambasi', 'light.gizli_ama_secili', 'scene.film']);
  assert.deepEqual(sayfa.sunucu.favoriler.map((f) => f.entity_id), ['light.salon_lambasi', 'light.gizli_ama_secili', 'scene.film']);
});

test('sıra: kendi üstüne bırakmak ve sürükleme başlamadan gelen dragover / drop hiçbir şey yapmaz', async () => {
  const sayfa = await duzenSayfasi();
  const satirlar = sira(sayfa);
  const bos = { type: 'dragover', clientY: 5, preventDefault() { this.onlendi = true; } };
  satirlar[1].dispatchEvent(bos);
  assert.equal(bos.onlendi, undefined, 'sürükleme yokken bırakmaya izin verilmez');
  satirlar[1].dispatchEvent({ type: 'drop', clientY: 5, preventDefault() {} });
  satirlar[0].dispatchEvent({ type: 'dragstart', dataTransfer: { setData() {} } });
  satirlar[0].dispatchEvent({ type: 'drop', clientY: 5, preventDefault() {} }); // kendi üstüne
  assert.deepEqual(sirali(sayfa), ['Salon Lambası', 'Film', 'Seçili Gizli']);
  assert.equal(kirliMi(sayfa), false);
  satirlar[0].dispatchEvent({ type: 'dragend' });
  assert.equal(satirlar[0].className, 'sira-satir');
});

test('sıra: cihaz listesi yüklenmediyse satırlar sürüklenemez (↑ ↓ düğmeleri gibi)', async () => {
  const sayfa = await acilmisSayfa({ ayar: { ...AYAR_DUZEN, anahtarVar: false }, cihazlar: CIHAZLAR_D3 });
  const ilk = sira(sayfa)[0];
  assert.equal(ilk.attributes.draggable, undefined);
  assert.equal(ilk.bul((o) => o.className === 'sira-tutamac').length, 0);
});

test('sıra: ↑ ↓ düğmesindeyken Alt+↑ / Alt+↓ satırı taşır ve taşınma duyurulur; Alt olmadan ya da başka tuşta hiçbir şey olmaz', async () => {
  const sayfa = await duzenSayfasi();
  const alt = (anahtar, ek = {}) => tusOlayi({ key: anahtar, altKey: true, ...ek });

  const olay = alt('ArrowDown');
  sira(sayfa)[0].dispatchEvent(olay);
  assert.equal(olay.onlendi, true, 'tarayıcının varsayılan davranışı engellenir');
  assert.deepEqual(sirali(sayfa), ['Film', 'Salon Lambası', 'Seçili Gizli']);
  assert.equal(duyuru(sayfa), metin('ayar.sira.tasindi', { ad: 'Salon Lambası', n: 2, toplam: 3 }));
  assert.equal(kirliMi(sayfa), true);

  sira(sayfa)[1].dispatchEvent(alt('ArrowUp'));
  assert.deepEqual(sirali(sayfa), ['Salon Lambası', 'Film', 'Seçili Gizli']);
  assert.equal(kirliMi(sayfa), false);

  // en üstte Alt+↑: değişmez
  const ustte = alt('ArrowUp');
  sira(sayfa)[0].dispatchEvent(ustte);
  assert.deepEqual(sirali(sayfa), ['Salon Lambası', 'Film', 'Seçili Gizli']);

  for (const olay2 of [tusOlayi({ key: 'ArrowDown' }), alt('ArrowDown', { ctrlKey: true }), alt('ArrowDown', { shiftKey: true }), alt('Enter')]) {
    sira(sayfa)[0].dispatchEvent(olay2);
    assert.equal(olay2.onlendi, false);
  }
  assert.deepEqual(sirali(sayfa), ['Salon Lambası', 'Film', 'Seçili Gizli']);
});

test('sıra: ↑ ↓ düğmeleri de taşıdığını duyurur', async () => {
  const sayfa = await duzenSayfasi();
  const asagi = sira(sayfa)[0].bul((o) => o.etiket === 'button' && o.textContent === '↓')[0];
  asagi.dispatchEvent({ type: 'click' });
  assert.deepEqual(sirali(sayfa), ['Film', 'Salon Lambası', 'Seçili Gizli']);
  assert.match(duyuru(sayfa), /Salon Lambası/);
});

// ---------------------------------------------------------------- panel sayfaları (o-24)

test('sayfalar: başlangıçta boş; "Sayfa ekle" adsız sayfa ekler, adı kutuya odaklanır, taslak kirli olur, kayıtta YALNIZ düzenlendiyse gider', async () => {
  const sayfa = await duzenSayfasi();
  assert.equal(sayfaSatirlari(sayfa).length, 0);
  assert.equal(sayfa.oge('sayfalarListesi').textContent, metin('ayar.sayfa.bos'));
  assert.equal(sayfa.oge('sayfalarListesi').children[0].attributes.role, 'listitem', 'role=list kabındaki boş durum iletisi listitem');
  assert.equal(sayfa.oge('sayfaSayaci').textContent, metin('ayar.sayfa.sayac', { n: 0, enCok: 12 }));
  assert.equal(sayfa.oge('sayfalarListesi').attributes['aria-label'], metin('ayar.sayfa.listeEtiket'));

  await kaydet(sayfa);
  assert.equal('sayfalar' in sonYuk(sayfa), false, 'düzenlenmediyse sayfalar kayıt yükünde yok (sunucudaki korunur)');

  sayfa.oge('btnSayfaEkle').dispatchEvent({ type: 'click' });
  const satirlar = sayfaSatirlari(sayfa);
  assert.equal(satirlar.length, 1);
  const ad = satirlar[0].bul((o) => o.etiket === 'input')[0];
  assert.equal(ad.placeholder, metin('sayfa.adsiz', { n: 1 }), 'adsız sayfa "Sayfa 1" ipucuyla görünür');
  assert.equal(sayfa.sonOdak(), ad, 'yeni sayfanın adına odaklanılır');
  assert.equal(duyuru(sayfa), metin('ayar.sayfa.eklendi', { ad: 'Sayfa 1' }));
  assert.equal(kirliMi(sayfa), true);
  assert.equal(sayfa.oge('sayfaSayaci').textContent, metin('ayar.sayfa.sayac', { n: 1, enCok: 12 }));

  yaz(ad, '  Salon   akşam ');
  await kaydet(sayfa);
  const yuk = sonYuk(sayfa).sayfalar;
  assert.equal(yuk.length, 1);
  assert.match(yuk[0].id, /^[a-z0-9]{3,12}$/);
  assert.equal(yuk[0].ad, 'Salon akşam', 'boşluklar sadeleştirilir');
  assert.deepEqual(yuk[0].varliklar, []);
  assert.equal(kirliMi(sayfa), false, 'kayıttan sonra temiz');
  assert.equal(sayfa.sunucu.sayfalar.length, 1);

  await kaydet(sayfa);
  assert.equal('sayfalar' in sonYuk(sayfa), false, 'ikinci kayıtta (düzenleme yok) tekrar gönderilmez');
});

test('sayfalar: ekle ve geri sil kirli bırakmaz; silmek onay ister (vazgeçilirse sayfa kalır)', async () => {
  const sayfa = await duzenSayfasi({ onayYaniti: false });
  sayfa.oge('btnSayfaEkle').dispatchEvent({ type: 'click' });
  assert.equal(kirliMi(sayfa), true);
  const sil = () => etiketle(sayfaSatirlari(sayfa)[0], /sayfasını sil$/);
  sil().dispatchEvent({ type: 'click' });
  assert.equal(sayfa.sorular.at(-1), metin('ayar.sayfa.silOnay', { ad: 'Sayfa 1' }));
  assert.equal(sayfaSatirlari(sayfa).length, 1, 'onay verilmedi: sayfa kalır');

  const onayli = await duzenSayfasi({ onayYaniti: true });
  onayli.oge('btnSayfaEkle').dispatchEvent({ type: 'click' });
  etiketle(sayfaSatirlari(onayli)[0], /sayfasını sil$/).dispatchEvent({ type: 'click' });
  assert.equal(sayfaSatirlari(onayli).length, 0);
  assert.equal(kirliMi(onayli), false, 'eklenip silinen sayfa değişiklik sayılmaz');
  assert.equal(duyuru(onayli), metin('ayar.sayfa.silindi', { ad: 'Sayfa 1' }));
  assert.equal(onayli.sonOdak(), onayli.oge('btnSayfaEkle'), 'son sayfa silinince odak "Sayfa ekle"ye gider');
});

test('sayfalar: yeni yazılan ad (kaydetmeden) silme onayında, "silindi" duyurusunda ve düğme adlarında kullanılır', async () => {
  const sayfa = await duzenSayfasi({ onayYaniti: true });
  sayfa.oge('btnSayfaEkle').dispatchEvent({ type: 'click' });
  const satir = () => sayfaSatirlari(sayfa)[0];
  const adKutusu = satir().bul((o) => o.etiket === 'input')[0];
  yaz(adKutusu, '  Salon   akşam ');
  adKutusu.dispatchEvent({ type: 'change' }); // ad kutusundan çıkış (blur)
  assert.ok(etiketle(satir(), /^Salon akşam sayfasını sil$/), 'düğme adları yeni adı söyler');
  assert.ok(etiketle(satir(), /^Salon akşam sayfasını çoğalt$/));
  assert.ok(etiketle(satir(), /^Salon akşam sayfasını aşağı taşı$/));
  assert.ok(!etiketle(satir(), /Sayfa 1/), 'eski ad kalmadı');

  etiketle(satir(), /sayfasını sil$/).dispatchEvent({ type: 'click' });
  assert.equal(sayfa.sorular.at(-1), metin('ayar.sayfa.silOnay', { ad: 'Salon akşam' }));
  assert.equal(sayfaSatirlari(sayfa).length, 0);
  assert.equal(duyuru(sayfa), metin('ayar.sayfa.silindi', { ad: 'Salon akşam' }));

  // blur olmadan (yalnız input olayı) doğrudan Sil'e basılsa da onay güncel adı söyler; ad boşaltılırsa "Sayfa n" döner
  sayfa.oge('btnSayfaEkle').dispatchEvent({ type: 'click' });
  yaz(satir().bul((o) => o.etiket === 'input')[0], 'Mutfak');
  etiketle(satir(), /sayfasını sil$/).dispatchEvent({ type: 'click' });
  assert.equal(sayfa.sorular.at(-1), metin('ayar.sayfa.silOnay', { ad: 'Mutfak' }));
  sayfa.oge('btnSayfaEkle').dispatchEvent({ type: 'click' });
  yaz(satir().bul((o) => o.etiket === 'input')[0], '   ');
  etiketle(satir(), /sayfasını sil$/).dispatchEvent({ type: 'click' });
  assert.equal(sayfa.sorular.at(-1), metin('ayar.sayfa.silOnay', { ad: 'Sayfa 1' }));
});

test('sayfalar: favori ekle / çıkar / sırala yalnız SEÇİLİ favorilerle; engelli (kapı kuralı) favoriler üye listesinde ve adaylarda görünmez', async () => {
  const ayar = {
    ...AYAR_DUZEN,
    favoriler: [...AYAR_DUZEN.favoriler, { entity_id: 'light.koridor', ad: 'Koridor' }],
    sayfalar: [{ id: 'abc12', ad: 'Akşam', varliklar: ['light.koridor', 'light.salon_lambasi', 'light.secilmemis'] }],
  };
  const cihazlar = { ...CIHAZLAR_D3, engelli: [{ entity_id: 'light.koridor', ad: 'Koridor' }] };
  const sayfa = await acilmisSayfa({ ayar, cihazlar });
  const satir = sayfaSatirlari(sayfa)[0];
  const uyeler = dugmeMetni(satir, metin('ayar.sayfa.uyeler', { n: 1 }));
  assert.ok(uyeler, 'üye sayısı yalnız seçili ve engelli olmayan favorileri sayar');
  assert.equal(uyeler.attributes['aria-expanded'], 'false');
  uyeler.dispatchEvent({ type: 'click' });

  const acik = sayfaSatirlari(sayfa)[0];
  assert.equal(dugmeMetni(acik, metin('ayar.sayfa.uyeler', { n: 1 })).attributes['aria-expanded'], 'true');
  const adlar = acik.bul((o) => o.className === 'sayfa-uye-ad').map((o) => o.textContent);
  assert.deepEqual(adlar, ['Salon Lambası']);
  assert.doesNotMatch(acik.textContent, /Koridor/, 'engelli favori sayfa düzenleyicisinde gösterilmez');
  const aday = secimler(acik)[0];
  assert.deepEqual(aday.children.map((o) => o.value), ['', 'scene.film', 'light.gizli_ama_secili'], 'adaylar: sayfada olmayan seçili favoriler');

  degistir(aday, 'scene.film');
  let guncel = sayfaSatirlari(sayfa)[0];
  assert.deepEqual(guncel.bul((o) => o.className === 'sayfa-uye-ad').map((o) => o.textContent), ['Salon Lambası', 'Film']);
  assert.equal(kirliMi(sayfa), true);

  // üç noktayla kesilebilen üye adının tam hali başlık (title) olarak da verilir
  assert.deepEqual(guncel.bul((o) => o.className === 'sayfa-uye-ad').map((o) => [o.textContent, o.title]), [['Salon Lambası', 'Salon Lambası'], ['Film', 'Film']]);

  // sayfa içinde sırala
  etiketle(guncel, /Film sayfada yukarı$/).dispatchEvent({ type: 'click' });
  guncel = sayfaSatirlari(sayfa)[0];
  assert.deepEqual(guncel.bul((o) => o.className === 'sayfa-uye-ad').map((o) => o.textContent), ['Film', 'Salon Lambası']);
  assert.equal(duyuru(sayfa), metin('ayar.sayfa.uyeTasindi', { ad: 'Film', n: 1 }));

  // Alt+↓ üyeyi taşır
  const uye = guncel.bul((o) => o.className === 'sayfa-uye')[0];
  uye.dispatchEvent(tusOlayi({ key: 'ArrowDown', altKey: true }));
  assert.deepEqual(sayfaSatirlari(sayfa)[0].bul((o) => o.className === 'sayfa-uye-ad').map((o) => o.textContent), ['Salon Lambası', 'Film']);

  // çıkar
  etiketle(sayfaSatirlari(sayfa)[0], /Film sayfadan çıkarılsın$/).dispatchEvent({ type: 'click' });
  assert.deepEqual(sayfaSatirlari(sayfa)[0].bul((o) => o.className === 'sayfa-uye-ad').map((o) => o.textContent), ['Salon Lambası']);

  // kayıt: seçili olmayan / engelli üyeler yükte kalır (ana süreç favori kaydında budar), kullanıcıya gösterilenler sırayla gider
  await kaydet(sayfa);
  const yuk = sonYuk(sayfa).sayfalar;
  assert.deepEqual(yuk[0].varliklar.filter((k) => k === 'light.salon_lambasi'), ['light.salon_lambasi']);
  assert.equal(yuk[0].varliklar.includes('scene.film'), false);
});

test('sayfalar: üye ↑ ↓ düğmesi ve Alt+ok taşıyınca odak taşınan üyenin düğmesinde kalır; uçta karşı yöndeki düğmeye geçer', async () => {
  const ayar = { ...AYAR_DUZEN, sayfalar: [{ id: 'abc12', ad: 'Hepsi', varliklar: ['light.salon_lambasi', 'scene.film', 'light.gizli_ama_secili'] }] };
  const sayfa = await acilmisSayfa({ ayar, cihazlar: CIHAZLAR_D3 });
  dugmeMetni(sayfaSatirlari(sayfa)[0], metin('ayar.sayfa.uyeler', { n: 3 })).dispatchEvent({ type: 'click' });
  const adlar = () => sayfaSatirlari(sayfa)[0].bul((o) => o.className === 'sayfa-uye-ad').map((o) => o.textContent);
  const dugme = (ad, yon) => etiketle(sayfaSatirlari(sayfa)[0], new RegExp(`^${ad} sayfada ${yon === 'yukari' ? 'yukarı' : 'aşağı'}$`));
  const uyeSatiri = (ad) => sayfaSatirlari(sayfa)[0].bul((o) => o.className === 'sayfa-uye').find((u) => u.bul((c) => c.className === 'sayfa-uye-ad')[0].textContent === ad);
  assert.deepEqual(adlar(), ['Salon Lambası', 'Film', 'Seçili Gizli']);

  // ortadaki üye: tıklanan yöndeki düğme (yeniden kurulan DOM'daki yeni düğme) odakta kalır
  const eskiDugme = dugme('Salon Lambası', 'asagi');
  eskiDugme.dispatchEvent({ type: 'click' });
  assert.deepEqual(adlar(), ['Film', 'Salon Lambası', 'Seçili Gizli']);
  assert.notEqual(dugme('Salon Lambası', 'asagi'), eskiDugme, 'satırlar yeniden kuruldu');
  assert.equal(sayfa.sonOdak(), dugme('Salon Lambası', 'asagi'));

  // Alt+↑ (klavye): ortadaki üyede "yukarı" düğmesi odakta kalır
  uyeSatiri('Seçili Gizli').dispatchEvent(tusOlayi({ key: 'ArrowUp', altKey: true }));
  assert.deepEqual(adlar(), ['Film', 'Seçili Gizli', 'Salon Lambası']);
  assert.equal(sayfa.sonOdak(), dugme('Seçili Gizli', 'yukari'));

  // uç: sona inen üyenin "aşağı" düğmesi kapalıdır, odak "yukarı"ya geçer; başa çıkınca "aşağı"ya
  dugme('Seçili Gizli', 'asagi').dispatchEvent({ type: 'click' });
  assert.deepEqual(adlar(), ['Film', 'Salon Lambası', 'Seçili Gizli']);
  assert.equal(dugme('Seçili Gizli', 'asagi').disabled, true);
  assert.equal(sayfa.sonOdak(), dugme('Seçili Gizli', 'yukari'));
  uyeSatiri('Film').dispatchEvent(tusOlayi({ key: 'ArrowDown', altKey: true }));
  uyeSatiri('Film').dispatchEvent(tusOlayi({ key: 'ArrowDown', altKey: true }));
  assert.deepEqual(adlar(), ['Salon Lambası', 'Seçili Gizli', 'Film']);
  dugme('Film', 'yukari').dispatchEvent({ type: 'click' });
  dugme('Film', 'yukari').dispatchEvent({ type: 'click' });
  assert.deepEqual(adlar(), ['Film', 'Salon Lambası', 'Seçili Gizli']);
  assert.equal(dugme('Film', 'yukari').disabled, true);
  assert.equal(sayfa.sonOdak(), dugme('Film', 'asagi'));
});

test('sayfalar: üye listesi seçimle birlikte güncellenir (favori seçimi kalkınca sayfadan düşer, gösterilmez)', async () => {
  const ayar = { ...AYAR_DUZEN, sayfalar: [{ id: 'abc12', ad: 'Hepsi', varliklar: ['light.salon_lambasi', 'scene.film'] }] };
  const sayfa = await acilmisSayfa({ ayar, cihazlar: CIHAZLAR_D3 });
  dugmeMetni(sayfaSatirlari(sayfa)[0], metin('ayar.sayfa.uyeler', { n: 2 })).dispatchEvent({ type: 'click' });
  assert.equal(sayfaSatirlari(sayfa)[0].bul((o) => o.className === 'sayfa-uye-ad').length, 2);
  girdiler(satirBul(sayfa, 'scene.film'))[0].tikla(); // sahne seçimini kaldır
  assert.deepEqual(sayfaSatirlari(sayfa)[0].bul((o) => o.className === 'sayfa-uye-ad').map((o) => o.textContent), ['Salon Lambası']);
  assert.ok(dugmeMetni(sayfaSatirlari(sayfa)[0], metin('ayar.sayfa.uyeler', { n: 1 })));
});

test('sayfalar: yeniden adlandır, çoğalt (üyeler kopyalanır, ad ek alır), sırala (↑ ↓ ve Alt+ok), duyurular', async () => {
  const ayar = { ...AYAR_DUZEN, sayfalar: [{ id: 'abc12', ad: 'Salon', varliklar: ['light.salon_lambasi'] }, { id: 'def34', ad: 'Mutfak', varliklar: [] }] };
  const sayfa = await acilmisSayfa({ ayar, cihazlar: CIHAZLAR_D3 });
  assert.equal(sayfaSatirlari(sayfa).length, 2);
  const adKutulari = () => sayfaSatirlari(sayfa).map((s) => s.bul((o) => o.etiket === 'input')[0].value);
  assert.deepEqual(adKutulari(), ['Salon', 'Mutfak']);

  // çoğalt: kopya özgün sayfanın hemen arkasına girer
  etiketle(sayfaSatirlari(sayfa)[0], /Salon sayfasını çoğalt$/).dispatchEvent({ type: 'click' });
  assert.deepEqual(adKutulari(), ['Salon', `Salon ${metin('ayar.sayfa.kopya')}`, 'Mutfak']);
  assert.equal(duyuru(sayfa), metin('ayar.sayfa.cogaltildi', { ad: `Salon ${metin('ayar.sayfa.kopya')}` }));
  assert.equal(kirliMi(sayfa), true);

  // aşağı taşı
  etiketle(sayfaSatirlari(sayfa)[0], /Salon sayfasını aşağı taşı$/).dispatchEvent({ type: 'click' });
  assert.deepEqual(adKutulari(), [`Salon ${metin('ayar.sayfa.kopya')}`, 'Salon', 'Mutfak']);
  assert.equal(duyuru(sayfa), metin('ayar.sayfa.tasindi', { ad: 'Salon', n: 2, toplam: 3 }));
  assert.equal(sayfa.sonOdak(), etiketle(sayfaSatirlari(sayfa)[1], /Salon sayfasını aşağı taşı$/), 'odak taşınan sayfanın aynı düğmesinde kalır');

  // Alt+↑ ad kutusundayken de taşır
  const ust = sayfaSatirlari(sayfa)[2].bul((o) => o.className === 'sayfa-ust')[0];
  const ad = ust.bul((o) => o.etiket === 'input')[0];
  ust.dispatchEvent(tusOlayi({ key: 'ArrowUp', altKey: true, target: ad }));
  assert.deepEqual(adKutulari(), [`Salon ${metin('ayar.sayfa.kopya')}`, 'Mutfak', 'Salon']);

  // adlandır
  yaz(sayfaSatirlari(sayfa)[1].bul((o) => o.etiket === 'input')[0], 'Yemek odası');
  await kaydet(sayfa);
  const yuk = sonYuk(sayfa).sayfalar;
  assert.deepEqual(yuk.map((s) => s.ad), [`Salon ${metin('ayar.sayfa.kopya')}`, 'Yemek odası', 'Salon']);
  assert.deepEqual(yuk[0].varliklar, ['light.salon_lambasi'], 'çoğaltılan sayfanın üyeleri kopyalanır');
  assert.equal(new Set(yuk.map((s) => s.id)).size, 3, 'kimlikler benzersiz');
  assert.equal(kirliMi(sayfa), false);
});

test('sayfalar: en çok 12 sayfa — sınırda "Sayfa ekle" ve "Çoğalt" pasif olur', async () => {
  const onikiSayfa = Array.from({ length: 12 }, (_, i) => ({ id: `sy${String(i).padStart(3, '0')}`, ad: `Sayfa ${i + 1}`, varliklar: [] }));
  const sayfa = await acilmisSayfa({ ayar: { ...AYAR_DUZEN, sayfalar: onikiSayfa }, cihazlar: CIHAZLAR_D3 });
  assert.equal(sayfaSatirlari(sayfa).length, 12);
  assert.equal(sayfa.oge('btnSayfaEkle').disabled, true);
  assert.equal(sayfa.oge('btnSayfaEkle').title, metin('ayar.sayfa.sinir', { enCok: 12 }));
  assert.equal(sayfa.oge('sayfaSayaci').textContent, metin('ayar.sayfa.sayac', { n: 12, enCok: 12 }));
  assert.equal(etiketle(sayfaSatirlari(sayfa)[0], /çoğalt$/).disabled, true);
  sayfa.oge('btnSayfaEkle').dispatchEvent({ type: 'click' });
  assert.equal(sayfaSatirlari(sayfa).length, 12, 'sınırı aşan ekleme yok sayılır');
  // sil -> yeniden açılır
  etiketle(sayfaSatirlari(sayfa)[0], /sayfasını sil$/).dispatchEvent({ type: 'click' });
  assert.equal(sayfa.oge('btnSayfaEkle').disabled, false);
});

test('sayfalar: sunucunun boşalttığı (kapı kuralına takılan) sayfa adı kullanıcıya söylenir; sayfa kalır ve adsız görünür', async () => {
  const sayfa = await duzenSayfasi({
    ayarKaydetYaniti: (yuk, sunucu) => {
      sunucu.sayfalar = yuk.sayfalar.map((s) => ({ ...s, ad: '' }));
      return { ok: true, uyarilar: [{ alan: 'sayfalar', mesaj: '1 sayfa adı güvenlik kuralına takıldığı için boşaltıldı.' }] };
    },
  });
  sayfa.oge('btnSayfaEkle').dispatchEvent({ type: 'click' });
  yaz(sayfaSatirlari(sayfa)[0].bul((o) => o.etiket === 'input')[0], 'Ön kapı');
  await kaydet(sayfa);
  assert.match(bildirim(sayfa), /güvenlik kuralına takıldığı için boşaltıldı/);
  const ad = sayfaSatirlari(sayfa)[0].bul((o) => o.etiket === 'input')[0];
  assert.equal(ad.value, '', 'sunucudaki değer gösterilir');
  assert.equal(ad.placeholder, metin('sayfa.adsiz', { n: 1 }));
  assert.equal(kirliMi(sayfa), false);
});

test('sayfalar: panel menüsünden (arka planda) değişen sayfalar, düzenlenmemişse taslağa yansır; düzenleniyorsa kullanıcının taslağı korunur', async () => {
  const sayfa = await duzenSayfasi();
  sayfa.sunucu.sayfalar = [{ id: 'abc12', ad: 'Menüden', varliklar: ['light.salon_lambasi'] }];
  await sayfa.favoriDegisti();
  assert.equal(sayfaSatirlari(sayfa).length, 1);
  assert.equal(kirliMi(sayfa), false, 'temiz taslak sunucuyu izler ve kirli sayılmaz');

  sayfa.oge('btnSayfaEkle').dispatchEvent({ type: 'click' }); // düzenleniyor
  sayfa.sunucu.sayfalar = [];
  await sayfa.favoriDegisti();
  assert.equal(sayfaSatirlari(sayfa).length, 2, 'düzenlenen taslak ezilmez');
  assert.equal(kirliMi(sayfa), true);
});

// ---------------------------------------------------------------- düzen geçmişi (o-30)

const NOKTALAR = [
  { id: 7, zaman: Date.UTC(2026, 9, 15, 10, 30), neden: 'kaydet', favoriSayisi: 3, sayfaSayisi: 1 },
  { id: 6, zaman: Date.UTC(2026, 9, 14, 9, 0), neden: 'onar', favoriSayisi: 4, sayfaSayisi: 0 },
];
const gecmisSatirlari = (sayfa) => sayfa.oge('duzenGecmisiListesi').bul((o) => o.className === 'gecmis-satir');

test('geçmiş: noktalar zaman, neden ve sayılarla listelenir; kimlik / ad göstermez; boş ve hata durumları', async () => {
  const bos = await duzenSayfasi();
  assert.equal(bos.oge('duzenGecmisiListesi').textContent, metin('ayar.gecmis.bos'));
  assert.equal(bos.oge('duzenGecmisiListesi').children[0].attributes.role, 'listitem', 'role=list kabındaki boş durum iletisi listitem');
  assert.equal(cagriSayisi(bos, 'duzenGecmisiniGetir'), 1);

  const sayfa = await duzenSayfasi({ gecmis: NOKTALAR });
  const satirlar = gecmisSatirlari(sayfa);
  assert.equal(satirlar.length, 2);
  assert.match(satirlar[0].textContent, new RegExp(metin('ayar.gecmis.neden.kaydet')));
  assert.match(satirlar[0].textContent, /3 favori, 1 sayfa/);
  assert.match(satirlar[1].textContent, new RegExp(metin('ayar.gecmis.neden.onar')));
  assert.equal(sayfa.oge('duzenGecmisiListesi').attributes['aria-label'], metin('ayar.gecmis.listeEtiket'));
  assert.doesNotMatch(sayfa.oge('duzenGecmisiListesi').textContent, /light\.|scene\./, 'varlık kimliği geçmiş listesinde görünmez');

  const hatali = await duzenSayfasi({ gecmisYaniti: () => ({ ok: false }) });
  assert.equal(hatali.oge('duzenGecmisiListesi').textContent, metin('ayar.gecmis.listeHata'));
  assert.equal(hatali.oge('duzenGecmisiListesi').children[0].attributes.role, 'listitem');

  // bilinmeyen neden yine de listelenir (kayıt nedeniyle), bozuk satırlar atılır
  const kirli = await duzenSayfasi({ gecmis: [{ id: 1, zaman: 5, neden: 'bilinmeyen', favoriSayisi: 2, sayfaSayisi: 0 }, { id: 'x' }, null] });
  assert.equal(gecmisSatirlari(kirli).length, 1);
});

test('geçmiş: "Bu düzene dön" onay ister; onayla ana sürece o noktanın kimliğini yollar, sayfa yeniden yüklenir ve sonuç söylenir', async () => {
  const sayfa = await duzenSayfasi({
    gecmis: NOKTALAR,
    donYaniti: (id, sunucu) => {
      sunucu.favoriler = sunucu.favoriler.slice(0, 2);
      sunucu.sayfalar = [{ id: 'abc12', ad: 'Eski', varliklar: [] }];
      return { ok: true, favoriSayisi: 2, sayfaSayisi: 1, atilan: 0 };
    },
  });
  const getirOnce = sayfa.getirSayisi();
  dugmeMetni(gecmisSatirlari(sayfa)[1], metin('ayar.gecmis.don')).dispatchEvent({ type: 'click' });
  await akit();
  assert.equal(sayfa.sorular.at(-1), metin('ayar.gecmis.donOnay'));
  assert.deepEqual(sayfa.cagrilar.find((c) => c[0] === 'duzeneDon'), ['duzeneDon', 6]);
  assert.ok(sayfa.getirSayisi() > getirOnce, 'ayarlar sunucudan yeniden alındı');
  assert.equal(bildirim(sayfa), metin('ayar.gecmis.donuldu', { f: 2, s: 1 }));
  assert.match(sayfa.oge('genelBildirim').className, /bildirim-basarili/);
  assert.equal(sayfaSatirlari(sayfa).length, 1, 'dönülen düzenin sayfaları görünür');
  assert.equal(sayfa.oge('secilenSayisi').textContent, metin('ayar.favori.secili', { n: 2 }).replace('{n}', '2'));
  assert.equal(cagriSayisi(sayfa, 'duzenGecmisiniGetir') >= 2, true, 'geçmiş listesi tazelenir (dönüş de yeni bir nokta ekler)');
});

test('geçmiş: geri dönüşten sonra tıklanan düğme listeyle yok olsa da odak listedeki "Bu düzene dön" düğmesine geçer; hata olursa aynı düğmede kalır', async () => {
  const sayfa = await duzenSayfasi({ gecmis: NOKTALAR, donYaniti: () => ({ ok: true, favoriSayisi: 3, sayfaSayisi: 0, atilan: 0 }) });
  const tiklanan = dugmeMetni(gecmisSatirlari(sayfa)[1], metin('ayar.gecmis.don'));
  tiklanan.dispatchEvent({ type: 'click' });
  await akit();
  const yeniListe = gecmisSatirlari(sayfa).map((s) => dugmeMetni(s, metin('ayar.gecmis.don')));
  assert.equal(yeniListe.includes(tiklanan), false, 'liste yeniden çizildi, tıklanan düğme belgede yok');
  assert.ok(sayfa.sonOdak(), 'odak bir yere verildi');
  assert.equal(sayfa.sonOdak(), yeniListe[0], 'odak listedeki ilk "Bu düzene dön" düğmesinde');

  const hatali = await duzenSayfasi({ gecmis: NOKTALAR, donYaniti: () => ({ ok: false, hata: 'Bu düzen noktası artık yok.' }) });
  const hataDugmesi = dugmeMetni(gecmisSatirlari(hatali)[1], metin('ayar.gecmis.don'));
  hataDugmesi.dispatchEvent({ type: 'click' });
  await akit();
  assert.equal(hataDugmesi.disabled, false);
  assert.equal(hatali.sonOdak(), hataDugmesi, 'liste çizilmedi: odak devre dışı kalan düğmeye geri verilir');
});

test('geçmiş: onay verilmezse hiçbir çağrı yapılmaz; kaydedilmemiş değişiklik varken onay metni bunu da söyler; hata ve atlanan kayıtlar bildirilir', async () => {
  const reddedilen = await duzenSayfasi({ gecmis: NOKTALAR, onayYaniti: false });
  dugmeMetni(gecmisSatirlari(reddedilen)[0], metin('ayar.gecmis.don')).dispatchEvent({ type: 'click' });
  await akit();
  assert.equal(cagriSayisi(reddedilen, 'duzeneDon'), 0);

  const kirliSayfa = await duzenSayfasi({ gecmis: NOKTALAR });
  yaz(kirliSayfa.oge('yerelAdres'), 'http://192.168.1.77:8123');
  dugmeMetni(gecmisSatirlari(kirliSayfa)[0], metin('ayar.gecmis.don')).dispatchEvent({ type: 'click' });
  await akit();
  assert.equal(kirliSayfa.sorular.at(-1), `${metin('ayar.gecmis.donOnay')} ${metin('ayar.gecmis.donKirli')}`);

  const hatali = await duzenSayfasi({ gecmis: NOKTALAR, donYaniti: () => ({ ok: false, hata: 'Bu düzen noktası artık yok.' }) });
  dugmeMetni(gecmisSatirlari(hatali)[0], metin('ayar.gecmis.don')).dispatchEvent({ type: 'click' });
  await akit();
  assert.equal(bildirim(hatali), 'Bu düzen noktası artık yok.');
  assert.match(hatali.oge('genelBildirim').className, /bildirim-hata/);

  const atlanan = await duzenSayfasi({ gecmis: NOKTALAR, donYaniti: () => ({ ok: true, favoriSayisi: 2, sayfaSayisi: 0, atilan: 2 }) });
  dugmeMetni(gecmisSatirlari(atlanan)[0], metin('ayar.gecmis.don')).dispatchEvent({ type: 'click' });
  await akit();
  assert.match(bildirim(atlanan), /2 kayıt güvenlik kuralı ya da sınırlar nedeniyle alınmadı/);
  assert.match(atlanan.oge('genelBildirim').className, /bildirim-uyari/);
});

test('geçmiş: ayarlar kaydedilince liste tazelenir', async () => {
  const sayfa = await duzenSayfasi({ gecmis: [] });
  assert.equal(gecmisSatirlari(sayfa).length, 0);
  sayfa.gecmisiDegistir(NOKTALAR);
  yaz(sayfa.oge('yerelAdres'), 'http://192.168.1.50:8123');
  await kaydet(sayfa);
  assert.equal(gecmisSatirlari(sayfa).length, 2);
});

// ---------------------------------------------------------------- kullanılamayan favoriyi onarma (o-28)

const AYAR_ONAR = {
  ...AYAR_D3,
  favoriler: [{ entity_id: 'light.salon_lambasi', ad: 'Salon Lambası' }, { entity_id: 'light.eski_lamba', ad: 'Eski Lamba', etiket: 'Okuma köşesi' }],
  sayfalar: [{ id: 'abc12', ad: 'Akşam', varliklar: ['light.eski_lamba', 'light.salon_lambasi'] }],
};
const CIHAZLAR_ONAR = { ...CIHAZLAR_D3, eksik: [{ entity_id: 'light.eski_lamba', ad: 'Eski Lamba' }] };
const onarSayfasi = (ek = {}) => acilmisSayfa({ ayar: AYAR_ONAR, cihazlar: CIHAZLAR_ONAR, ...ek });

test('onarım: yalnız HA’da bulunamayan satırda "Onar…" düğmesi; aynı türden, henüz favori olmayan güvenli cihazlar aday olur', async () => {
  const sayfa = await onarSayfasi();
  const eksikSatir = satirBul(sayfa, 'light.eski_lamba');
  assert.match(eksikSatir.className, /satir-bulunamadi/);
  const ac = etiketle(eksikSatir, /favorisini onar$/);
  assert.ok(ac, 'onar düğmesi var');
  assert.equal(etiketle(satirBul(sayfa, 'light.salon_lambasi'), /favorisini onar$/), undefined, 'çalışan favoride yok');
  assert.equal(secimler(eksikSatir).length, 0, 'açılmadan aday listesi yok');

  ac.dispatchEvent({ type: 'click' });
  assert.equal(ac.attributes['aria-expanded'], 'true');
  const sec = secimler(eksikSatir)[0];
  // aynı alan (light) ve favori olmayan: gizli_aday ve gizli_ama_secili; sahne / düğme / zaten favori olan salon_lambasi yok
  const degerler = sec.children.map((o) => o.value).filter(Boolean).sort();
  assert.deepEqual(degerler, ['light.gizli_aday', 'light.gizli_ama_secili']);
  assert.equal(dugmeMetni(eksikSatir, metin('ayar.onar.bagla')).disabled, true, 'aday seçilene dek bağlanamaz');

  // vazgeç
  dugmeMetni(eksikSatir, metin('ayar.onar.vazgec')).dispatchEvent({ type: 'click' });
  assert.equal(ac.attributes['aria-expanded'], 'false');
  assert.equal(secimler(eksikSatir).length, 0);
  assert.equal(sayfa.sonOdak(), ac, 'vazgeçince odak "Onar…" düğmesine döner');
  assert.equal(cagriSayisi(sayfa, 'favoriyiOnar'), 0);
});

test('onarım: aday listesi arayüz dilinin alfabesiyle sıralanır (Türkçede Ç Ş Ğ İ Ö Ü sona atılmaz), eşit adlarda kimlik belirler', async () => {
  const aday = (kimlik, ad) => ({ entity_id: kimlik, ad, alan: 'light', alanEtiketi: 'Işıklar', durum: '', onayZorunlu: false, varsayilanOnay: false, kisayolUygun: true, gizli: false });
  const cihazlar = {
    ...CIHAZLAR_ONAR,
    cihazlar: [
      ...CIHAZLAR_ONAR.cihazlar,
      aday('light.isik', 'Işık'),
      aday('light.salon_b', 'Salon'),
      aday('light.yatak', 'Yatak odası'),
      aday('light.cocuk', 'Çocuk odası'),
      aday('light.utu', 'Ütü'),
      aday('light.salon_a', 'Salon'),
    ],
  };
  const sirala = async (ek = {}) => {
    const sayfa = await onarSayfasi({ cihazlar, ...ek });
    const eksikSatir = satirBul(sayfa, 'light.eski_lamba');
    eksikSatir.bul((o) => o.etiket === 'button' && o.attributes['aria-expanded'] !== undefined)[0].dispatchEvent({ type: 'click' }); // "Onar…" düğmesi
    return secimler(eksikSatir)[0].children.map((o) => o.value).filter((v) => v !== '' && !v.startsWith('light.gizli_'));
  };
  assert.deepEqual(await sirala(), ['light.cocuk', 'light.isik', 'light.salon_a', 'light.salon_b', 'light.utu', 'light.yatak']);
  assert.deepEqual(
    await sirala({ ayar: { ...AYAR_ONAR, dil: 'en', dilAyari: 'en', sistemDili: 'en' } }),
    ['light.cocuk', 'light.isik', 'light.salon_a', 'light.salon_b', 'light.utu', 'light.yatak'],
    'İngilizce sıralamada da Ç ve Ü kendi harflerinin yanında (Z sonrasına atılmaz)',
  );
});

test('onarım: aday seçilip onaylanınca ana sürece (eski, yeni) gider; yerel seçim ve sayfa üyeliği yeni cihaza taşınır, kayıt onarımı geri almaz', async () => {
  const sayfa = await onarSayfasi();
  etiketle(satirBul(sayfa, 'light.eski_lamba'), /favorisini onar$/).dispatchEvent({ type: 'click' });
  const sec = secimler(satirBul(sayfa, 'light.eski_lamba'))[0];
  degistir(sec, 'light.gizli_aday');
  const bagla = dugmeMetni(satirBul(sayfa, 'light.eski_lamba'), metin('ayar.onar.bagla'));
  assert.equal(bagla.disabled, false);
  bagla.dispatchEvent({ type: 'click' });
  await akit();

  assert.equal(sayfa.sorular.at(-1), metin('ayar.onar.onay', { ad: 'Eski Lamba', yeni: 'Gizli Aday' }));
  assert.deepEqual(sayfa.cagrilar.find((c) => c[0] === 'favoriyiOnar'), ['favoriyiOnar', 'light.eski_lamba', 'light.gizli_aday']);
  assert.equal(bildirim(sayfa), metin('ayar.onar.tamam', { ad: 'Eski Lamba' }));
  assert.deepEqual(sayfa.sunucu.favoriler.map((f) => f.entity_id), ['light.salon_lambasi', 'light.gizli_aday']);
  assert.equal(satirlarVarMi(sayfa, 'light.eski_lamba'), false, 'eski kimlik satırı kalktı');
  assert.equal(satirlarVarMi(sayfa, 'light.gizli_aday'), true);
  assert.equal(kirliMi(sayfa), false, 'onarım kullanıcı değişikliği gibi kirli bırakmaz');
  assert.deepEqual(sirali(sayfa), ['Salon Lambası', 'Okuma köşesi'], 'karo adı yeni cihaza taşınır; sıra korunur');

  // sayfa üyeliği yeni kimliğe geçti ve taslak kirli değil
  assert.deepEqual(sayfa.sunucu.sayfalar[0].varliklar, ['light.gizli_aday', 'light.salon_lambasi']);
  dugmeMetni(sayfaSatirlari(sayfa)[0], metin('ayar.sayfa.uyeler', { n: 2 })).dispatchEvent({ type: 'click' });
  assert.deepEqual(sayfaSatirlari(sayfa)[0].bul((o) => o.className === 'sayfa-uye-ad').map((o) => o.textContent), ['Okuma köşesi', 'Salon Lambası']);

  // sonraki kayıt eski kimliği geri getirmez
  yaz(sayfa.oge('yerelAdres'), 'http://192.168.1.60:8123');
  await kaydet(sayfa);
  assert.deepEqual(sayfa.sunucu.favoriler.map((f) => f.entity_id), ['light.salon_lambasi', 'light.gizli_aday']);
  assert.equal(cagriSayisi(sayfa, 'favorileriKaydet'), 0, 'seçim değişmedi: favori çağrısı yok');
  assert.equal('sayfalar' in sonYuk(sayfa), false);
});

test('onarım: bekleyen karo adı ve görünüm düzenlemeleri yeni kimliğe taşınır', async () => {
  const sayfa = await onarSayfasi();
  const eski = satirBul(sayfa, 'light.eski_lamba');
  // eksik satırda ad / görünüm kutusu yok (cihaz bilgisi yok); önce yerel olarak seçili sıra dışında bir şey değişmiş olsun: sıra
  const asagi = sira(sayfa)[0].bul((o) => o.etiket === 'button' && o.textContent === '↓')[0];
  asagi.dispatchEvent({ type: 'click' }); // [Eski, Salon]
  assert.deepEqual(sirali(sayfa), ['Okuma köşesi', 'Salon Lambası']);
  etiketle(eski, /favorisini onar$/).dispatchEvent({ type: 'click' });
  degistir(secimler(eski)[0], 'light.gizli_aday');
  dugmeMetni(eski, metin('ayar.onar.bagla')).dispatchEvent({ type: 'click' });
  await akit();
  // yerel sıra korunur: yeni cihaz eskisinin yerinde (ilk), karo adı sunucuda kaldığı için sıra panelinde cihaz adı görünür
  assert.equal(sira(sayfa).length, 2);
  assert.match(siraMetni(sira(sayfa)[0]), /Gizli Aday|Okuma köşesi/);
  assert.equal(kirliMi(sayfa), true, 'sıra değişikliği (kaydedilmemiş) korunur');
  await kaydet(sayfa);
  assert.deepEqual(sonYuk(sayfa, 'favorileriKaydet').map((g) => g.entity_id), ['light.gizli_aday', 'light.salon_lambasi'], 'kayıt yeni kimlikle, yerel sırayla gider');
});

test('onarım: ana süreç reddederse hata söylenir, hiçbir şey değişmez; aday yoksa ya da liste yüklenmemişse bunu söyler', async () => {
  const reddeden = await onarSayfasi({ onarYaniti: () => ({ ok: false, neden: 'guvenlik', hata: 'Bu cihaz güvenli listede değil.' }) });
  etiketle(satirBul(reddeden, 'light.eski_lamba'), /favorisini onar$/).dispatchEvent({ type: 'click' });
  degistir(secimler(satirBul(reddeden, 'light.eski_lamba'))[0], 'light.gizli_aday');
  dugmeMetni(satirBul(reddeden, 'light.eski_lamba'), metin('ayar.onar.bagla')).dispatchEvent({ type: 'click' });
  await akit();
  assert.equal(bildirim(reddeden), 'Bu cihaz güvenli listede değil.');
  assert.match(reddeden.oge('genelBildirim').className, /bildirim-hata/);
  assert.deepEqual(reddeden.sunucu.favoriler.map((f) => f.entity_id), ['light.salon_lambasi', 'light.eski_lamba']);
  assert.equal(dugmeMetni(satirBul(reddeden, 'light.eski_lamba'), metin('ayar.onar.bagla')).disabled, false, 'tekrar denenebilir');

  const onaysiz = await onarSayfasi({ onayYaniti: false });
  etiketle(satirBul(onaysiz, 'light.eski_lamba'), /favorisini onar$/).dispatchEvent({ type: 'click' });
  degistir(secimler(satirBul(onaysiz, 'light.eski_lamba'))[0], 'light.gizli_aday');
  dugmeMetni(satirBul(onaysiz, 'light.eski_lamba'), metin('ayar.onar.bagla')).dispatchEvent({ type: 'click' });
  await akit();
  assert.equal(cagriSayisi(onaysiz, 'favoriyiOnar'), 0, 'onay verilmedi');

  // aynı alanda başka cihaz yok
  const adaysiz = await acilmisSayfa({
    ayar: { ...AYAR_ONAR, favoriler: [AYAR_ONAR.favoriler[0], { entity_id: 'switch.eski_priz', ad: 'Eski Priz' }], sayfalar: [] },
    cihazlar: { ...CIHAZLAR_D3, eksik: [{ entity_id: 'switch.eski_priz', ad: 'Eski Priz' }] },
  });
  etiketle(satirBul(adaysiz, 'switch.eski_priz'), /favorisini onar$/).dispatchEvent({ type: 'click' });
  assert.match(satirBul(adaysiz, 'switch.eski_priz').textContent, new RegExp(metin('ayar.onar.adayYok')));
});

const satirlarVarMi = (sayfa, kimlik) => {
  try {
    return !!satirBul(sayfa, kimlik);
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------- panel menüsü "Düzenle…" odağı (o-16)

test('"Düzenle…": ana süreç favori kimliği yollayınca Favoriler bölümüne gidilir ve satırın seçim kutusuna odaklanılır (süzgeç gizliyorsa daraltılır)', async () => {
  const sayfa = await duzenSayfasi();
  const filtre = sayfa.oge('cihazAra');
  yaz(filtre, 'bulunmayan sözcük');
  assert.equal(satirlarVarMi(sayfa, 'scene.film'), false, 'süzgeç satırı gizledi');
  await sayfa.favoriyeGit('scene.film');
  assert.equal(filtre.value, 'scene.film', 'süzgeç bu favoriye daraltıldı');
  assert.equal(sayfa.sonOdak(), girdiler(satirBul(sayfa, 'scene.film'))[0]);

  // seçili olmayan / bilinmeyen kimlik: süzgece yazılmaz, hata vermez
  yaz(filtre, '');
  await sayfa.favoriyeGit('light.yok_boyle_bir_sey');
  assert.equal(filtre.value, '');
  await sayfa.favoriyeGit('');
  await sayfa.favoriyeGit(42);
});

test('"Düzenle…": ayar özetindeki odakFavori (Ayarlar bu istekle açıldı) cihaz listesi yüklenince uygulanır', async () => {
  const sayfa = await acilmisSayfa({ ayar: { ...AYAR_DUZEN, odakFavori: 'light.gizli_ama_secili' }, cihazlar: CIHAZLAR_D3 });
  assert.equal(sayfa.sonOdak(), girdiler(satirBul(sayfa, 'light.gizli_ama_secili'))[0]);
});

// ---------------------------------------------------------------- dil

test('İngilizce: sayfalar, geçmiş, görünüm ve onarım metinleri yeni dilde; görünür metinlerde Türkçe harf yok; dil geri değişince Türkçe', async () => {
  const ayar = {
    ...AYAR_D3,
    dil: 'en',
    dilAyari: 'en',
    sistemDili: 'en',
    panolar: [],
    favoriler: [{ entity_id: 'light.living_room', ad: 'Living Room Lamp' }, { entity_id: 'scene.movie', ad: 'Movie' }, { entity_id: 'light.old_lamp', ad: 'Old Lamp' }],
    sayfalar: [{ id: 'abc12', ad: 'Evening', varliklar: ['light.living_room'] }],
  };
  const aygit = (kimlik, ad, alan, etiket) => ({ entity_id: kimlik, ad, alan, alanEtiketi: etiket, durum: 'on', onayZorunlu: false, varsayilanOnay: false, kisayolUygun: true, gizli: false });
  const cihazlar = {
    ok: true,
    cihazlar: [aygit('light.living_room', 'Living Room Lamp', 'light', 'Lights'), aygit('scene.movie', 'Movie', 'scene', 'Scenes'), aygit('light.hall', 'Hall Lamp', 'light', 'Lights')],
    eksik: [{ entity_id: 'light.old_lamp', ad: 'Old Lamp' }],
    engelli: [],
  };
  const sayfa = await acilmisSayfa({ ayar, cihazlar, gecmis: NOKTALAR });
  assert.equal(sayfa.oge('sayfaSayaci').textContent, '1 / 12 pages');
  assert.equal(sayfa.oge('btnSayfaEkle').textContent, 'Add page');
  assert.ok(dugmeMetni(gecmisSatirlari(sayfa)[0], 'Go back to this layout'));
  assert.match(gecmisSatirlari(sayfa)[0].textContent, /Before settings were saved · Favorites: 3, pages: 1/);
  const isik = satirBul(sayfa, 'light.living_room');
  assert.equal(secimler(isik)[1].children[1].textContent, 'Normal');
  assert.ok(dugmeMetni(satirBul(sayfa, 'light.old_lamp'), 'Repair…'));
  dugmeMetni(sayfaSatirlari(sayfa)[0], 'Favorites (1)').dispatchEvent({ type: 'click' });
  etiketle(satirBul(sayfa, 'light.old_lamp'), /^Repair the favorite/).dispatchEvent({ type: 'click' });

  const turkce = gorunurMetinler(sayfa).filter(([, m]) => TURKCE_HARF.test(m));
  assert.deepEqual(turkce, [], 'görünür metinlerde Türkçe harf yok');

  // sıra duyurusu ve sayfa silme onayı da İngilizce
  sira(sayfa)[0].dispatchEvent(tusOlayi({ key: 'ArrowDown', altKey: true }));
  assert.equal(duyuru(sayfa), 'Living Room Lamp moved to position 2 of 3.');
  etiketle(sayfaSatirlari(sayfa)[0], /^Delete page/).dispatchEvent({ type: 'click' });
  assert.doesNotMatch(sayfa.sorular.at(-1), TURKCE_HARF);

  // dil Türkçeye dönünce düzen bölümü de Türkçe
  await sayfa.dilDegisti('tr');
  assert.equal(sayfa.oge('btnSayfaEkle').textContent, 'Sayfa ekle');
  assert.match(sayfa.oge('sayfaSayaci').textContent, /sayfa$/);
  assert.ok(dugmeMetni(gecmisSatirlari(sayfa)[0], 'Bu düzene dön'));
});

test('düzen betiği yoksa Ayarlar eskisi gibi çalışır (EvAyarlarDuzen tanımsız): sıra, kayıt ve satırlar bozulmaz', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const ayarlarBetigi = fs.readFileSync(path.join(__dirname, '..', 'src', 'ayarlar.js'), 'utf8');
  assert.match(ayarlarBetigi, /const DuzenModulu = window\.EvAyarlarDuzen \|\| null;/);
  assert.match(ayarlarBetigi, /if \(!DuzenModulu\) return null;/);
});

// --- Emoji seçici (1.4.0) --------------------------------------------------------------------------------------------------

const emojiSecDugmesi = (satir) => satir.bul((o) => o.classList.contains('gorunum-emoji-sec'))[0];
const seciciKutusu = (satir) => satir.bul((o) => o.className === 'emoji-secici')[0];
const seciciOgeleri = (satir) => satir.bul((o) => o.className === 'emoji-oge');
const seciciArama = (satir) => satir.bul((o) => o.className === 'emoji-ara')[0];
const KAPI_EMOJILERI = ['🚪', '🔒', '🔓', '🔐', '🔏', '🔑', '🗝', '🚨', '🚧', '🪟', '⛩'];

test('emoji önerileri: her biri karo-gorunum doğrulamasından aynen geçer, tekrar yok, kapı / kilit / anahtar / siren temalı emoji yok; her önerinin beş dilde adı var', () => {
  const sandbox = { window: null };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'lib', 'karo-gorunum.js'), 'utf8'), sandbox);
  const Gorunum = sandbox.EvKaroGorunum;
  const D = yardimcilar();
  const oneriler = D.EMOJI_ONERILERI.map((o) => [...o]);
  assert.ok(oneriler.length >= 40 && oneriler.length <= 60, `liste küçük ve sınırlı (${oneriler.length})`);
  assert.equal(new Set(oneriler.map((o) => o[0])).size, oneriler.length, 'emoji tekrarı yok');
  assert.equal(new Set(oneriler.map((o) => o[1])).size, oneriler.length, 'ad anahtarı tekrarı yok');
  for (const [emoji, anahtar] of oneriler) {
    assert.equal(Gorunum.simgeDuzelt(emoji), emoji, `${emoji} doğrulamadan geçmeli`);
    assert.ok(Gorunum.simgeCoz(emoji)?.tur === 'emoji', emoji);
    for (const kapi of KAPI_EMOJILERI) assert.ok(!emoji.includes(kapi), `${emoji}: kapı kuralı`);
    for (const dil of ['tr', 'en', 'de', 'fr', 'es']) assert.ok((AYARLAR[dil][anahtar] ?? '').trim() !== '', `${anahtar} ${dil}`);
  }
  // kapı emojileri doğrulamada zaten reddedilir (seçici ek bir yetki vermez)
  for (const kapi of KAPI_EMOJILERI) assert.equal(Gorunum.simgeDuzelt(kapi), null, kapi);
});

test('emoji seçici: yalnız "Listeden seç" ile açılır, ad aksan / büyük-küçük harf farkı olmadan aranır, seçilen emoji kayda gider ve seçici kapanır', async () => {
  const sayfa = await duzenSayfasi();
  const isik = satirBul(sayfa, 'light.salon_lambasi');
  const dugme = emojiSecDugmesi(isik);
  assert.equal(dugme.style.display, 'none', 'emoji modu açılmadan seçici düğmesi yok');
  assert.equal(seciciKutusu(isik), undefined, 'seçici ilk açılışa dek kurulmaz');
  degistir(secimler(isik)[2], 'emoji');
  assert.equal(dugme.style.display, '');
  assert.equal(dugme.attributes['aria-expanded'], 'false');
  assert.equal(dugme.textContent, metin('ayar.gorunum.emojiSec'));
  for (const sinif of ['buton', 'buton-ikincil', 'buton-kucuk']) assert.ok(dugme.classList.contains(sinif), `"Seç" düğmesi ${sinif} sınıfını taşır (tarayıcı varsayılan görünümünde kalmaz)`);

  dugme.dispatchEvent({ type: 'click' });
  assert.equal(dugme.attributes['aria-expanded'], 'true');
  assert.equal(seciciKutusu(isik).style.display, '');
  const ogeler = seciciOgeleri(isik);
  assert.equal(ogeler.length, 50);
  assert.deepEqual(ogeler.slice(0, 2).map((o) => o.attributes['aria-label']), [metin('ayar.emoji.ampul'), metin('ayar.emoji.mum')]);
  assert.ok(ogeler.every((o) => o.title === o.attributes['aria-label'] && o.title !== ''));
  for (const kapi of KAPI_EMOJILERI) assert.ok(!ogeler.some((o) => o.textContent.includes(kapi)), `${kapi} listede yok`);
  assert.equal(kirliMi(sayfa), false, 'seçici açmak değişiklik sayılmaz');

  const ara = seciciArama(isik);
  const sorgula = (sorgu) => {
    yaz(ara, sorgu);
    return seciciOgeleri(isik).map((o) => o.textContent);
  };
  assert.deepEqual(sorgula('ISITMA'), ['🔥'], 'büyük harf');
  assert.deepEqual(sorgula('ısıtma'), ['🔥'], 'noktasız ı, noktalı i ile bulunur');
  assert.deepEqual(sorgula('isitma'), ['🔥']);
  assert.deepEqual(sorgula('  su '), sorgula('su'), 'baştaki / sondaki boşluk kırpılır');
  assert.ok(sorgula('su').includes('💧'));
  assert.deepEqual(sorgula('muzik'), ['🎵'], 'Türkçe karaktersiz yazım');
  const bosNot = isik.bul((o) => o.className === 'cihaz-not' && o.textContent === metin('ayar.gorunum.emojiBulunamadi'))[0];
  assert.equal(sorgula('xyzqq').length, 0);
  assert.equal(bosNot.style.display, 'block', 'eşleşme yoksa söylenir');
  assert.equal(sorgula('').length, 50);
  assert.equal(bosNot.style.display, 'none');

  sorgula('isitma');
  seciciOgeleri(isik)[0].dispatchEvent({ type: 'click' });
  assert.equal(emojiKutusu(isik).value, '🔥');
  assert.equal(seciciKutusu(isik).style.display, 'none', 'seçimden sonra kapanır');
  assert.equal(dugme.attributes['aria-expanded'], 'false');
  assert.equal(dugme.odaklanma > 0, true, 'odak düğmeye döner');
  assert.equal(kirliMi(sayfa), true);
  await kaydet(sayfa);
  assert.equal(new Map(sonYuk(sayfa, 'favorileriKaydet').map((g) => [g.entity_id, g])).get('light.salon_lambasi').simge, '🔥');

  // yeniden açılınca arama sıfırlanır; Escape kapatır, Enter ilk sonucu seçer
  dugme.dispatchEvent({ type: 'click' });
  assert.equal(seciciArama(isik).value, '');
  assert.equal(seciciOgeleri(isik).length, 50);
  seciciArama(isik).dispatchEvent(tusOlayi({ key: 'Escape' }));
  assert.equal(seciciKutusu(isik).style.display, 'none');
  dugme.dispatchEvent({ type: 'click' });
  yaz(seciciArama(isik), 'gece');
  seciciArama(isik).dispatchEvent(tusOlayi({ key: 'Enter' }));
  assert.equal(emojiKutusu(isik).value, '🌙');
  assert.equal(seciciKutusu(isik).style.display, 'none');
});

test('emoji seçici: ızgaradaki düğmeden (kutuya kabarır) ve açıkken "Emoji seç" düğmesinden Esc seçiciyi kapatır, olay pencereye ulaşmaz; kapalıyken olay geçer', async () => {
  const sayfa = await duzenSayfasi();
  const isik = satirBul(sayfa, 'light.salon_lambasi');
  degistir(secimler(isik)[2], 'emoji');
  const dugme = emojiSecDugmesi(isik);
  dugme.dispatchEvent({ type: 'click' });
  assert.equal(seciciKutusu(isik).style.display, '');

  // sahte DOM olayı kabartmaz: ızgara düğmesinden kabaran Esc doğrudan kutuya gönderilir
  const izgaraEsc = tusOlayi({ key: 'Escape' });
  seciciKutusu(isik).dispatchEvent(izgaraEsc);
  assert.equal(seciciKutusu(isik).style.display, 'none');
  assert.equal(dugme.attributes['aria-expanded'], 'false');
  assert.equal(izgaraEsc.onlendi, true);
  assert.equal(izgaraEsc.durduruldu, true, 'belge düzeyindeki Esc (pencereyi kapatır) çalışmaz');
  assert.equal(sayfa.sonOdak(), dugme);

  dugme.dispatchEvent({ type: 'click' });
  assert.equal(seciciKutusu(isik).style.display, '');
  const dugmeEsc = tusOlayi({ key: 'Escape' });
  dugme.dispatchEvent(dugmeEsc);
  assert.equal(seciciKutusu(isik).style.display, 'none');
  assert.equal(dugme.attributes['aria-expanded'], 'false');
  assert.equal(dugmeEsc.onlendi, true);
  assert.equal(dugmeEsc.durduruldu, true);
  assert.equal(sayfa.sonOdak(), dugme);

  // seçici kapalıyken Esc engellenmez (pencere kapanma akışı olduğu gibi çalışır)
  const kapaliEsc = tusOlayi({ key: 'Escape' });
  dugme.dispatchEvent(kapaliEsc);
  assert.equal(kapaliEsc.onlendi, false);
  assert.equal(kapaliEsc.durduruldu, false);
  const ilkAcilmamis = satirBul(sayfa, 'light.gizli_ama_secili');
  degistir(secimler(ilkAcilmamis)[2], 'emoji');
  const hicAcilmamis = tusOlayi({ key: 'Escape' });
  emojiSecDugmesi(ilkAcilmamis).dispatchEvent(hicAcilmamis);
  assert.equal(hicAcilmamis.onlendi, false, 'seçici hiç kurulmamışken de olay geçer');
});

test('emoji seçici: ad arayüz dilinde aranır (Almanca), simge listeden çizgi ikona dönülünce düğme ve seçici gizlenir, satır seçili değilken düğme kapalıdır', async () => {
  const sayfa = await duzenSayfasi({ ayar: { ...AYAR_DUZEN, dil: 'de', dilAyari: 'de', sistemDili: 'de' } });
  const isik = satirBul(sayfa, 'light.salon_lambasi');
  degistir(secimler(isik)[2], 'emoji');
  const dugme = emojiSecDugmesi(isik);
  assert.equal(dugme.textContent, metin('ayar.gorunum.emojiSec', {}, 'de'));
  dugme.dispatchEvent({ type: 'click' });
  const ara = seciciArama(isik);
  assert.equal(ara.placeholder, metin('ayar.gorunum.emojiAra', {}, 'de'));
  yaz(ara, 'KUCHE');
  assert.deepEqual(seciciOgeleri(isik).map((o) => o.textContent), ['🍳'], 'Küche, ü / u farkı olmadan');
  assert.equal(seciciOgeleri(isik)[0].title, metin('ayar.emoji.mutfak', {}, 'de'));
  yaz(ara, 'mutfak');
  assert.equal(seciciOgeleri(isik).length, 0, 'Türkçe ad Almanca arayüzde aranmaz');

  degistir(secimler(isik)[2], 'ikon:ev');
  assert.equal(dugme.style.display, 'none');
  assert.equal(seciciKutusu(isik).style.display, 'none');

  const gizli = satirBul(sayfa, 'light.gizli_ama_secili');
  degistir(secimler(gizli)[2], 'emoji');
  const secici = emojiSecDugmesi(gizli);
  secici.dispatchEvent({ type: 'click' });
  assert.equal(seciciKutusu(gizli).style.display, '');
  // satırın seçimi kaldırılınca kontroller kapanır ve açık seçici kapanır
  const secimKutusu = girdiler(gizli).find((g) => g.type === 'checkbox');
  secimKutusu.checked = false;
  secimKutusu.dispatchEvent({ type: 'change' });
  assert.equal(secici.disabled, true);
  assert.equal(seciciKutusu(gizli).style.display, 'none');
});

test('emoji seçici: Almanca dışındaki üç dilde de öneri adları çevrilmiş ve Türkçeye özgü harf içermez', () => {
  const D = yardimcilar();
  for (const dil of ['en', 'de', 'fr', 'es']) {
    for (const [, anahtar] of D.EMOJI_ONERILERI) {
      const ad = AYARLAR[dil][anahtar];
      assert.doesNotMatch(ad, /[ğĞıİşŞ]/, `${dil} ${anahtar}`);
      if (dil === 'en') assert.doesNotMatch(ad, TURKCE_HARF, `${dil} ${anahtar}`);
    }
  }
});
