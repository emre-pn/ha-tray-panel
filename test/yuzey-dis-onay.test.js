'use strict';

/**
 * 1.4.0 dis grubu (o-54): hızlı paneldeki evpaneli:// bağlantı izni betiği (src/yuzey-dis-onay.js) minik bir SAHTE DOM ile çalışır:
 * gerçek tarayıcı, Electron ya da pencere YOK. Amaç: soru yalnız köprüden okunur, karar yalnız sorunun biletiyle gider, "İzin ver"
 * kısa süre kapalıdır, Esc reddeder, tuşlar ızgaraya gitmez, metin textContent ile ve seçili dilde yazılır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const KOK = path.join(__dirname, '..');
const oku = (g) => fs.readFileSync(path.join(KOK, g), 'utf8');
const HTML = oku('src/yuzey.html');
const BETIKLER = ['src/lib/dil.js', 'src/lib/ceviri/yuzey.js', 'src/yuzey-dis-onay.js'].map((g) => [g, oku(g)]);

class Oge {
  constructor(id, belge) {
    this.id = id;
    this.belge = belge;
    this.hidden = false;
    this.disabled = false;
    this.textContent = '';
    this.dinleyiciler = {};
    this.odak = 0;
  }

  addEventListener(tur, fn) {
    (this.dinleyiciler[tur] ??= []).push(fn);
  }

  focus() {
    this.odak += 1;
    this.belge.activeElement = this;
  }

  gonder(tur, ek = {}) {
    const olay = { type: tur, target: this, durdu: false, onlendi: false, stopPropagation() { this.durdu = true; }, preventDefault() { this.onlendi = true; }, ...ek };
    for (const fn of this.dinleyiciler[tur] ?? []) fn(olay);
    return olay;
  }
}

function ortam({ dil = 'tr', soru = null } = {}) {
  const zamanlayicilar = [];
  const cagrilar = [];
  const dinleyiciler = {};
  let guncelSoru = soru;
  let yanitSonucu = { ok: true };
  const kimlikler = new Set([...HTML.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const belge = {
    activeElement: null,
    ogeler: new Map(),
    documentElement: { lang: dil, getAttribute: (ad) => (ad === 'lang' ? belge.documentElement.lang : null), setAttribute: (ad, d) => (ad === 'lang' ? (belge.documentElement.lang = d) : null) },
    getElementById(id) {
      assert.ok(kimlikler.has(id), `yuzey.html: #${id} yok`);
      if (!this.ogeler.has(id)) {
        const o = new Oge(id, belge);
        if (/^disOnay(Izin|HerZaman)$/.test(id)) o.disabled = true; // HTML'deki varsayılan
        if (id === 'disOnay') o.hidden = true;
        this.ogeler.set(id, o);
      }
      return this.ogeler.get(id);
    },
  };
  const boyutlar = [];
  const kopru = {
    disOnayAl: async () => (cagrilar.push(['al']), { ok: true, soru: guncelSoru }),
    disOnayYanitla: async (bilet, karar) => (cagrilar.push(['yanitla', bilet, karar]), yanitSonucu),
    onGoster: (fn) => (dinleyiciler.goster = fn),
    onDisOnay: (fn) => (dinleyiciler.disOnay = fn),
    onDilDegisti: (fn) => (dinleyiciler.dil = fn),
  };
  const baglam = {
    document: belge,
    evYuzey: kopru,
    Event: class {
      constructor(tur) {
        this.type = tur;
      }
    },
    dispatchEvent: (o) => boyutlar.push(o.type),
    setTimeout: (fn, ms) => (zamanlayicilar.push({ fn, ms }), zamanlayicilar.length),
    clearTimeout: () => {},
    Promise,
    Object,
    Number,
    String,
    Math,
  };
  baglam.window = baglam;
  baglam.globalThis = baglam;
  vm.createContext(baglam);
  for (const [ad, kod] of BETIKLER) vm.runInContext(kod, baglam, { filename: ad });
  const el = (id) => belge.getElementById(id);
  return {
    el,
    belge,
    cagrilar,
    boyutlar,
    zamanlayicilar,
    dinleyiciler,
    soruAyarla: (s) => (guncelSoru = s),
    yanitAyarla: (y) => (yanitSonucu = y),
    zamanlayicilariCalistir: () => {
      for (const z of zamanlayicilar.splice(0)) z.fn();
    },
  };
}

const bekle = () => new Promise(setImmediate);
const SORU = { bilet: 'bilet-1', ad: 'Salon <b>ışığı</b>', islem: 'ac', bekleMs: 600 };

test('soru panel gösteriminde köprüden okunur; metin textContent ile yazılır; İzin ver bekleme süresi dolana kadar kapalı, odak Reddet', async () => {
  const o = ortam({ soru: SORU });
  o.dinleyiciler.goster({ mod: 'panel' });
  await bekle();
  assert.equal(o.el('disOnay').hidden, false);
  assert.equal(o.el('disOnaySoru').textContent, 'Bir bağlantı “Salon <b>ışığı</b>” favorisini çalıştırmak istiyor.');
  assert.equal(o.el('disOnayIslem').textContent, 'İstenen işlem: aç');
  assert.equal(o.el('disOnayIzin').disabled, true);
  assert.equal(o.el('disOnayHerZaman').disabled, true);
  assert.equal(o.belge.activeElement, o.el('disOnayReddet'));
  assert.ok(o.boyutlar.includes('resize'), 'panel yüksekliği yeniden ölçülür');
  // süre dolmadan tıklama hiçbir şey göndermez
  o.el('disOnayIzin').gonder('click');
  await bekle();
  assert.deepEqual(o.cagrilar.filter((c) => c[0] === 'yanitla'), []);
  assert.equal(o.zamanlayicilar.at(-1).ms, 600);
  o.zamanlayicilariCalistir();
  assert.equal(o.el('disOnayIzin').disabled, false);
  o.el('disOnayHerZaman').gonder('click');
  o.el('disOnayIzin').gonder('click'); // ikinci tıklama gönderim sürerken yok sayılır
  await bekle();
  assert.deepEqual(o.cagrilar.filter((c) => c[0] === 'yanitla'), [['yanitla', 'bilet-1', 'herZaman']]);
  assert.equal(o.el('disOnay').hidden, true);
  assert.equal(o.el('disOnaySoru').textContent, '');
});

test('Reddet hemen gider; Esc reddeder ve paneli kapatmaya gitmez; ok tuşları ızgaraya gitmez', async () => {
  const o = ortam({ soru: SORU });
  o.dinleyiciler.disOnay();
  await bekle();
  const ok = o.el('disOnay').gonder('keydown', { key: 'ArrowDown' });
  assert.equal(ok.durdu, true);
  const esc = o.el('disOnay').gonder('keydown', { key: 'Escape' });
  assert.equal(esc.durdu, true);
  assert.equal(esc.onlendi, true);
  await bekle();
  assert.deepEqual(o.cagrilar.filter((c) => c[0] === 'yanitla'), [['yanitla', 'bilet-1', 'reddet']]);
  assert.equal(o.el('disOnay').hidden, true);

  const o2 = ortam({ soru: { ...SORU, bilet: 'bilet-2' } });
  o2.dinleyiciler.disOnay();
  await bekle();
  o2.el('disOnayReddet').gonder('click');
  await bekle();
  assert.deepEqual(o2.cagrilar.filter((c) => c[0] === 'yanitla'), [['yanitla', 'bilet-2', 'reddet']]);
});

test('soru yoksa, geçersizse ya da palet açıldıysa bölüm gizli kalır; ret yanıtı gelirse güncel soru yeniden okunur', async () => {
  const o = ortam();
  o.dinleyiciler.goster({ mod: 'panel' });
  await bekle();
  assert.equal(o.el('disOnay').hidden, true);
  for (const kotu of [{ ...SORU, islem: 'sil' }, { ...SORU, bilet: '' }, { ...SORU, ad: 42 }, { ...SORU, islem: 'parlaklik' }, 'x']) {
    o.soruAyarla(kotu);
    o.dinleyiciler.disOnay();
    await bekle();
    assert.equal(o.el('disOnay').hidden, true, JSON.stringify(kotu));
  }
  o.soruAyarla(SORU);
  o.dinleyiciler.goster({ mod: 'palet' });
  await bekle();
  assert.equal(o.el('disOnay').hidden, true);
  assert.equal(o.cagrilar.filter((c) => c[0] === 'al').length, 6, 'palet gösteriminde soru okunmaz');

  o.dinleyiciler.goster({ mod: 'panel' });
  await bekle();
  o.zamanlayicilariCalistir();
  o.yanitAyarla({ ok: false });
  o.soruAyarla(null); // süre dolmuş
  o.el('disOnayIzin').gonder('click');
  await bekle();
  await bekle();
  assert.equal(o.el('disOnay').hidden, true);
  assert.equal(o.cagrilar.at(-1)[0], 'al');
});

test('B135: karar sonrası kutu gizlenince odak kutudaki düğmedeyse içerik alanına geçer (palette arama kutusuna); odak dışarıdaysa dokunulmaz', async () => {
  const o = ortam({ soru: SORU });
  o.dinleyiciler.goster({ mod: 'panel' });
  await bekle();
  o.zamanlayicilariCalistir();
  o.el('disOnayIzin').focus();
  assert.equal(o.belge.activeElement, o.el('disOnayIzin'));
  o.el('disOnayIzin').gonder('click');
  await bekle();
  assert.equal(o.el('disOnay').hidden, true);
  assert.equal(o.belge.activeElement, o.el('icerik'), 'izin sonrası odak gövdeye düşmedi');

  const red = ortam({ soru: { ...SORU, bilet: 'b-r' } });
  red.dinleyiciler.disOnay();
  await bekle();
  assert.equal(red.belge.activeElement, red.el('disOnayReddet'));
  red.el('disOnayReddet').gonder('click');
  await bekle();
  assert.equal(red.belge.activeElement, red.el('icerik'));

  // soru bitti (ana süreç başka yerden yanıtladı): kutu gizlenir, odak yine kurtarılır
  const bitti = ortam({ soru: { ...SORU, bilet: 'b-b' } });
  bitti.dinleyiciler.disOnay();
  await bekle();
  bitti.soruAyarla(null);
  bitti.dinleyiciler.disOnay();
  await bekle();
  assert.equal(bitti.el('disOnay').hidden, true);
  assert.equal(bitti.belge.activeElement, bitti.el('icerik'));

  // palet gösterilince kutu gizlenir: odak aramaya gider
  const palet = ortam({ soru: { ...SORU, bilet: 'b-p' } });
  palet.dinleyiciler.disOnay();
  await bekle();
  palet.dinleyiciler.goster({ mod: 'palet' });
  assert.equal(palet.belge.activeElement, palet.el('arama'));

  // odak kutunun dışındaysa (ör. kullanıcı kutuya hiç girmedi) dokunulmaz
  const disarida = ortam({ soru: { ...SORU, bilet: 'b-d' } });
  disarida.dinleyiciler.disOnay();
  await bekle();
  const baska = disarida.el('arama');
  baska.focus();
  disarida.soruAyarla(null);
  disarida.dinleyiciler.disOnay();
  await bekle();
  assert.equal(disarida.belge.activeElement, baska);
});

test('B136: aynı bilet bekleme süresi dolmadan yeniden okunursa (yeni nesne, daha küçük bekleMs) İzin ver / Her zaman süre sonunda yine açılır', async () => {
  const o = ortam({ soru: SORU });
  o.dinleyiciler.goster({ mod: 'panel' });
  await bekle();
  assert.equal(o.el('disOnayIzin').disabled, true);
  o.soruAyarla({ ...SORU, bekleMs: 100 }); // aynı bilet, yeni nesne (yenile her seferinde yenisini üretir)
  o.dinleyiciler.goster({ mod: 'panel' });
  await bekle();
  assert.equal(o.el('disOnayIzin').disabled, true, 'süre dolmadı');
  o.zamanlayicilariCalistir();
  assert.equal(o.el('disOnayIzin').disabled, false);
  assert.equal(o.el('disOnayHerZaman').disabled, false);
  assert.equal(o.el('disOnayReddet').disabled, false);

  // yeni bilet yine kendi bekleme süresini kurar: eski zamanlayıcı yeni soruyu erken açmaz
  const o2 = ortam({ soru: SORU });
  o2.dinleyiciler.goster({ mod: 'panel' });
  await bekle();
  o2.soruAyarla({ ...SORU, bilet: 'bilet-2' });
  o2.dinleyiciler.disOnay();
  await bekle();
  assert.equal(o2.el('disOnayIzin').disabled, true);
  const eski = o2.zamanlayicilar.splice(0, 1)[0];
  eski.fn(); // yeni biletten ÖNCEKİ bileti bekleyen zamanlayıcı
  assert.equal(o2.el('disOnayIzin').disabled, true, 'yeni bilet kendi süresini bekler');
});

test('B136: yanıt gönderilirken aynı bilet yeniden okunsa da başarılı yanıt kutuyu kapatır; başarısız yanıt kutuyu takılı bırakmaz', async () => {
  const o = ortam({ soru: SORU });
  o.dinleyiciler.goster({ mod: 'panel' });
  await bekle();
  o.zamanlayicilariCalistir();
  let coz;
  o.yanitAyarla(new Promise((c) => (coz = c)));
  o.el('disOnayIzin').gonder('click');
  await bekle();
  o.soruAyarla({ ...SORU, bekleMs: 0 }); // gönderim sürerken yeniden okuma
  o.dinleyiciler.disOnay();
  await bekle();
  coz({ ok: true });
  await bekle();
  assert.equal(o.el('disOnay').hidden, true, 'yanıt yok sayılmadı: kutu kapandı');
  assert.deepEqual(o.cagrilar.filter((c) => c[0] === 'yanitla'), [['yanitla', 'bilet-1', 'izin']]);

  // başarısız yanıt: gonderiliyor sıfırlanır, kullanıcı yeniden karar verebilir
  const k = ortam({ soru: SORU });
  k.dinleyiciler.goster({ mod: 'panel' });
  await bekle();
  k.zamanlayicilariCalistir();
  let coz2;
  k.yanitAyarla(new Promise((c) => (coz2 = c)));
  k.el('disOnayReddet').gonder('click');
  await bekle();
  k.soruAyarla({ ...SORU }); // yeniden okuma (yeni nesne)
  k.dinleyiciler.disOnay();
  await bekle();
  coz2({ ok: false });
  await bekle();
  await bekle();
  k.yanitAyarla({ ok: true });
  k.el('disOnayReddet').gonder('click');
  await bekle();
  assert.equal(k.cagrilar.filter((c) => c[0] === 'yanitla').length, 2, 'ikinci karar gönderilebildi');
  assert.equal(k.el('disOnay').hidden, true);
});

test('işlem satırı: parlaklık, göreli adım ve komut; dil değişince metin yeni dilde yeniden yazılır', async () => {
  const o = ortam({ soru: { ...SORU, islem: 'parlaklik', deger: 40 } });
  o.dinleyiciler.disOnay();
  await bekle();
  assert.equal(o.el('disOnayIslem').textContent, 'İstenen işlem: seviye %40');
  o.soruAyarla({ ...SORU, bilet: 'b-3', islem: 'goreli', deger: 10 });
  o.dinleyiciler.disOnay();
  await bekle();
  assert.equal(o.el('disOnayIslem').textContent, 'İstenen işlem: seviyeyi +10 değiştir');
  o.belge.documentElement.lang = 'en';
  o.dinleyiciler.dil({ dil: 'en' });
  assert.equal(o.el('disOnaySoru').textContent, 'A link wants to run the favorite “Salon <b>ışığı</b>”.');
  assert.equal(o.el('disOnayIslem').textContent, 'Requested action: change the level by +10');
  o.soruAyarla({ ...SORU, bilet: 'b-4', islem: 'komut' });
  o.dinleyiciler.disOnay();
  await bekle();
  assert.equal(o.el('disOnayIslem').textContent, 'Requested action: send a command');
});

test('betik HTML ataması ve ağ API\'si kullanmaz; yalnız preload\'un açtığı köprü işlevlerini çağırır', () => {
  const kod = oku('src/yuzey-dis-onay.js');
  assert.doesNotMatch(kod, /innerHTML|outerHTML|insertAdjacentHTML|\bfetch\s*\(|XMLHttpRequest|require\s*\(/);
  const kullanilan = new Set([...kod.matchAll(/kopru\.(\w+)/g)].map((m) => m[1]));
  assert.deepEqual([...kullanilan].sort(), ['disOnayAl', 'disOnayYanitla', 'onDilDegisti', 'onDisOnay', 'onGoster']);
  // betik sırası: sayfa betiğinden sonra (Esc ve ok tuşlarını bölüm kendisi tutar)
  const sira = [...HTML.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(sira.indexOf('yuzey-dis-onay.js') > sira.indexOf('yuzey-sayfa.js'));
});
