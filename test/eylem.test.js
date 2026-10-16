'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { eylemKatmaniOlustur, eylemHataMetni, REST_SONRASI_YENILEME_MS } = require('../src/eylem');
const { durumDeposuOlustur } = require('../src/lib/durum-deposu');
const { yuzeyModeliOlustur } = require('../src/lib/yuzey-modeli');

const SUNUCU = {
  'light.led': { entity_id: 'light.led', state: 'on', attributes: { friendly_name: 'LED şerit' } },
  'light.ampul': { entity_id: 'light.ampul', state: 'off', attributes: { friendly_name: 'Ampul' } },
  'scene.film': { entity_id: 'scene.film', state: 'unknown', attributes: { friendly_name: 'Film' } },
  'button.pc_mediavolumeup': { entity_id: 'button.pc_mediavolumeup', state: 'unknown', attributes: { friendly_name: 'Ses +' } },
  'button.pc_bilgisayari_kapat': { entity_id: 'button.pc_bilgisayari_kapat', state: 'unknown', attributes: { friendly_name: 'Bilgisayarı kapat' } },
  'script.gizli_kapat': { entity_id: 'script.gizli_kapat', state: 'off', attributes: { friendly_name: 'Bilgisayarı kapat' } },
  'light.kapi_lambasi': { entity_id: 'light.kapi_lambasi', state: 'on', attributes: { friendly_name: 'Kapı lambası' } },
};
const FAVORILER = [
  { entity_id: 'light.led', ad: 'LED şerit', parlaklik: true },
  { entity_id: 'light.ampul', ad: 'Ampul' },
  { entity_id: 'scene.film', ad: 'Film' },
  { entity_id: 'button.pc_mediavolumeup', ad: 'Ses +' },
  { entity_id: 'button.pc_bilgisayari_kapat', ad: 'PC kapat' },
  { entity_id: 'script.gizli_kapat', ad: 'Işık senaryosu' }, // kayıtlı ad masum, HA'daki güncel ad "kapat" ipucu taşıyor
  { entity_id: 'light.kapi_lambasi', ad: 'Lamba' },
];

function ortam({ canli = false, diyalogYaniti = true, onayAcik = false, zamanSimdi = () => 1000, karolar = null } = {}) {
  const istekler = [];
  const bildirimler = [];
  const sonlar = [];
  const diyaloglar = [];
  const zamanlayicilar = [];
  const yenilemeler = [];
  const oncelikler = []; // GET isteklerinin öncelik seçeneği (tur 5, K10)
  const bekleyenBildirimler = [];
  const depo = durumDeposuOlustur({ gruplamaMs: 0, zaman: { setTimeout: () => 0, clearTimeout: () => {} } });
  const ayarlar = { favoriler: FAVORILER };
  const katman = eylemKatmaniOlustur({
    ayarlarAl: () => ayarlar,
    depo,
    canliMi: () => canli,
    haIstek: async (yol, secenek = {}) => {
      istekler.push({ yol, yontem: secenek.yontem ?? 'GET', govde: secenek.govde });
      oncelikler.push(secenek.oncelik);
      const e = /^\/api\/states\/(.+)$/.exec(yol);
      if (e) {
        if (!SUNUCU[e[1]]) throw Object.assign(new Error('x'), { tur: 'bulunamadi' });
        return SUNUCU[e[1]];
      }
      return [];
    },
    son: { ekle: (k) => sonlar.push(k) },
    geriBildirim: (b) => bildirimler.push(b),
    durumlariYenile: async () => {
      yenilemeler.push(1);
    },
    onayDiyalogu: async (ad, kimlik) => {
      diyaloglar.push([ad, kimlik]);
      return diyalogYaniti;
    },
    onayAcikMi: () => onayAcik,
    onayBekleniyorBildir: () => bekleyenBildirimler.push(1),
    karolariAl: () => karolar ?? yuzeyModeliOlustur({ favoriler: FAVORILER, durumAl: (k) => SUNUCU[k] }).gruplar.flatMap((g) => g.karolar),
    gunluk: () => {},
    zaman: { setTimeout: (fn, ms) => zamanlayicilar.push({ fn, ms }) },
    simdi: zamanSimdi,
  });
  const postlar = () => istekler.filter((i) => i.yontem === 'POST');
  return { katman, depo, istekler, oncelikler, postlar, bildirimler, sonlar, diyaloglar, zamanlayicilar, yenilemeler, bekleyenBildirimler };
}

test('panelden zararsız eylem: tek POST, başarı bildirimi, "Son" listesine eklenir', async () => {
  const o = ortam();
  const s = await o.katman.yuzeydenCalistir('panel', { kimlik: 'light.ampul' });
  assert.deepEqual([s.ok, s.ad], [true, 'Ampul']);
  assert.equal(o.postlar().length, 1);
  assert.deepEqual(o.postlar()[0], { yol: '/api/services/light/toggle', yontem: 'POST', govde: { entity_id: 'light.ampul' } });
  assert.deepEqual(o.bildirimler.map((b) => b.tur), ['ok']);
  assert.deepEqual(o.sonlar, ['light.ampul']);
});

test('"Son" yalnız panel/palet + zararsız: kısayol, komut satırı, tepsi ve yıkıcı eylem listeye girmez', async () => {
  const o = ortam();
  await o.katman.kisayolla('light.ampul');
  await o.katman.komutSatirindan('film');
  await o.katman.tepsiTikla('light.ampul');
  assert.equal(o.postlar().length, 3);
  assert.deepEqual(o.sonlar, []);
  await o.katman.yuzeydenCalistir('palet', { kimlik: 'scene.film' });
  assert.deepEqual(o.sonlar, ['scene.film']);
  o.katman.basiliBasla('button.pc_bilgisayari_kapat');
  const o2 = ortam({ zamanSimdi: (() => { let t = 0; return () => (t += 1000); })() });
  o2.katman.basiliBasla('button.pc_bilgisayari_kapat');
  const yikici = await o2.katman.yuzeydenCalistir('panel', { kimlik: 'button.pc_bilgisayari_kapat', basili: true });
  assert.equal(yikici.ok, true);
  assert.deepEqual(o2.sonlar, [], 'yıkıcı eylem "Son"a yazılmaz');
});

test('parlaklık: ara değerler sessiz, sonDeger bildirim verir; ses -/+ basılı tutma sessiz', async () => {
  const o = ortam();
  await o.katman.yuzeydenCalistir('panel', { kimlik: 'light.led', parlaklik: 30 });
  await o.katman.yuzeydenCalistir('panel', { kimlik: 'light.led', parlaklik: 40 });
  assert.equal(o.bildirimler.length, 0, 'sürükleme ara değerleri bildirim üretmez');
  await o.katman.yuzeydenCalistir('panel', { kimlik: 'light.led', parlaklik: 45, sonDeger: true });
  assert.deepEqual(o.bildirimler.map((b) => b.metin), ['LED şerit: %45']);
  assert.deepEqual(o.postlar().map((p) => p.govde.brightness_pct), [30, 40, 45]);
  const ses = ortam();
  // ses -/+ hazır listede 'tekrar' işaretlidir; bu test ortamının favorisi 'Ses +' kimliğiyle eşleşir
  await ses.katman.yuzeydenCalistir('panel', { kimlik: 'button.pc_mediavolumeup' });
  assert.equal(ses.bildirimler.length, 0);
  assert.equal(ses.postlar().length, 1);
});

test('hatalar: yasak/ulaşılamıyor vb. hata bildirimi verir; onay-gerekli ve cok-sik sessizdir', async () => {
  const o = ortam();
  const yasak = await o.katman.yuzeydenCalistir('panel', { kimlik: 'light.kapi_lambasi' });
  assert.deepEqual([yasak.ok, yasak.tur], [false, 'yasak']);
  assert.equal(o.postlar().length, 0);
  assert.equal(o.bildirimler.length, 1);
  assert.equal(o.bildirimler[0].tur, 'hata');
  assert.match(o.bildirimler[0].metin, /^Yapılamadı: /);
  const onaysiz = await o.katman.yuzeydenCalistir('panel', { kimlik: 'button.pc_bilgisayari_kapat' });
  assert.deepEqual([onaysiz.ok, onaysiz.tur], [false, 'onay-gerekli']);
  assert.equal(o.bildirimler.length, 1, 'onay-gerekli sessiz');
  let cok;
  for (let i = 0; i < 12; i += 1) cok = await o.katman.yuzeydenCalistir('panel', { kimlik: 'light.ampul' });
  assert.equal(cok.tur, 'cok-sik');
  assert.equal(o.bildirimler.filter((b) => b.tur === 'hata').length, 1, 'cok-sik sessiz');
});

test('yuzeydenCalistir: bozuk yükler HA\'ya hiç gitmez', async () => {
  const o = ortam();
  for (const yuk of [null, undefined, [], 'light.ampul', {}, { kimlik: 5 }, { kimlik: 'x'.repeat(500) }, { kimlik: 'light.ampul', parlaklik: '40' }, { kimlik: 'light.led', parlaklik: 1.5 }]) {
    const s = await o.katman.yuzeydenCalistir('panel', yuk);
    assert.equal(s.ok, false, JSON.stringify(yuk));
  }
  assert.equal((await o.katman.yuzeydenCalistir('tarayici', { kimlik: 'light.ampul' })).tur, 'gecersiz');
  assert.equal((await o.katman.yuzeydenCalistir('tepsi-menu', { kimlik: 'light.ampul' })).tur, 'gecersiz', 'renderer tepsi kaynağıyla çağıramaz');
  assert.equal(o.postlar().length, 0);
});

test('basılı tutma: renderer "basili:true" dese de ana süreç saati dolmadan yıkıcı eylem çalışmaz; tek kullanımlık', async () => {
  let t = 0;
  const o = ortam({ zamanSimdi: () => t });
  assert.equal((await o.katman.yuzeydenCalistir('panel', { kimlik: 'button.pc_bilgisayari_kapat', basili: true })).tur, 'onay-gerekli', 'başlamadan');
  assert.equal(o.katman.basiliBasla('button.pc_bilgisayari_kapat'), true);
  t += 300;
  assert.equal((await o.katman.yuzeydenCalistir('panel', { kimlik: 'button.pc_bilgisayari_kapat', basili: true })).tur, 'onay-gerekli', 'erken');
  assert.equal(o.postlar().length, 0);
  o.katman.basiliBasla('button.pc_bilgisayari_kapat');
  t += 800;
  assert.equal((await o.katman.yuzeydenCalistir('palet', { kimlik: 'button.pc_bilgisayari_kapat', basili: true })).ok, true);
  assert.equal(o.postlar().length, 1);
  assert.equal((await o.katman.yuzeydenCalistir('palet', { kimlik: 'button.pc_bilgisayari_kapat', basili: true })).tur, 'onay-gerekli', 'tek kullanımlık');
  assert.equal(o.katman.basiliBasla('light.olmayan'), false, 'favori olmayan kimlik için basış kaydedilmez');
  assert.equal(o.katman.basiliBasla(5), false);
});

test('kısayol ve komut satırı yıkıcı eylemi ASLA çalıştırmaz (hata bildirimi, POST yok)', async () => {
  const o = ortam();
  const k = await o.katman.kisayolla('button.pc_bilgisayari_kapat');
  assert.deepEqual([k.ok, k.tur], [false, 'kaynak-izinsiz']);
  const c = await o.katman.komutSatirindan('pc kapat');
  assert.equal(c.ok, false);
  assert.equal(o.postlar().length, 0);
  assert.ok(o.bildirimler.every((b) => b.tur === 'hata'));
});

test('komut satırı: ad çözülür; belirsiz ve bulunamayan ad hiçbir şey çalıştırmaz ve sabit metinle bildirilir', async () => {
  const o = ortam();
  assert.equal((await o.katman.komutSatirindan('film')).ok, true);
  assert.equal(o.postlar()[0].yol, '/api/services/scene/turn_on');
  assert.equal((await o.katman.komutSatirindan('led 40')).ok, true);
  assert.equal(o.postlar()[1].govde.brightness_pct, 40);
  const once = o.postlar().length;
  const yok = await o.katman.komutSatirindan('olmayan bir sey');
  assert.deepEqual([yok.ok, yok.tur], [false, 'bulunamadi']);
  assert.equal(o.postlar().length, once);
  const hata = o.bildirimler.at(-1);
  assert.equal(hata.tur, 'hata');
  assert.ok(!hata.metin.includes('olmayan'), 'kullanıcı metni yankılanmaz');
  const cift = ortam({ karolar: [{ id: 'light.ampul', etiket: 'Lamba' }, { id: 'light.led', etiket: 'Lamba' }] });
  assert.deepEqual(await cift.katman.komutSatirindan('lamba'), { ok: false, tur: 'belirsiz' });
  assert.equal(cift.postlar().length, 0, 'belirsiz ad hiçbir şey çalıştırmaz');
  assert.match(cift.bildirimler[0].metin, /birden çok/);
});

test('komut satırı (h-23): "led 0" ışığı KAPATIR (turn_off), aç/kapat yapmaz; "ampul 0" ve "led 101" hiçbir şey çalıştırmaz', async () => {
  const o = ortam();
  const s = await o.katman.komutSatirindan('led 0');
  assert.equal(s.ok, true);
  assert.equal(o.postlar().length, 1);
  assert.deepEqual(o.postlar()[0], { yol: '/api/services/light/turn_off', yontem: 'POST', govde: { entity_id: 'light.led' } });
  assert.equal((await o.katman.komutSatirindan('led %40')).ok, true);
  assert.equal(o.postlar()[1].govde.brightness_pct, 40);
  const once = o.postlar().length;
  for (const ad of ['ampul 0', 'ampul 40', 'led 101']) assert.equal((await o.katman.komutSatirindan(ad)).ok, false, ad);
  assert.equal(o.postlar().length, once, 'kısılamayan ışıkta sayı aç/kapat yapmaz');
});

test('palet "ışık 0" (kapat): yalnız sabit turn_off servisi; renderer başka servis adı gönderemez; kısılamayan ve yıkıcı varlıkta reddedilir', async () => {
  const o = ortam();
  assert.equal((await o.katman.yuzeydenCalistir('palet', { kimlik: 'light.led', kapat: true })).ok, true);
  assert.deepEqual(o.postlar()[0], { yol: '/api/services/light/turn_off', yontem: 'POST', govde: { entity_id: 'light.led' } });
  // 1.4.0: renderer servis adı gönderebilir ama yalnız alanın izin listesindeki servis çalışır (servis-izinleri.js); "kapat" yalnız true.
  const once = o.postlar().length;
  await o.katman.yuzeydenCalistir('palet', { kimlik: 'light.ampul', servis: 'turn_on' });
  await o.katman.yuzeydenCalistir('palet', { kimlik: 'light.ampul', kapat: 'turn_on' });
  assert.deepEqual(o.postlar().slice(once).map((p) => p.yol), ['/api/services/light/turn_on', '/api/services/light/toggle']);
  for (const servis of ['unlock', 'open_cover', 'alarm_disarm', 'turn_on; x', 'TURN_ON', '__proto__']) {
    const s = await o.katman.yuzeydenCalistir('palet', { kimlik: 'light.ampul', servis });
    assert.deepEqual([s.ok, s.tur], [false, 'gecersiz'], servis);
  }
  const s2 = await o.katman.yuzeydenCalistir('palet', { kimlik: 'light.ampul', servis: 'turn_on', kapat: true });
  assert.deepEqual([s2.ok, s2.tur], [false, 'gecersiz'], 'servis ile kapat birlikte verilemez');
  assert.equal(o.postlar().length, once + 2, 'izinsiz servis ağa çıkmaz');
  // Parlaklık verilmişse kapat yok sayılır; parlaklık kuralları değişmez.
  await o.katman.yuzeydenCalistir('palet', { kimlik: 'light.led', parlaklik: 30, kapat: true });
  assert.equal(o.postlar().at(-1).govde.brightness_pct, 30);
  // Düğme alanında turn_off izinli değil; yıkıcı eylem yine onay ister.
  const dugme = await o.katman.yuzeydenCalistir('palet', { kimlik: 'button.pc_mediavolumeup', kapat: true });
  assert.deepEqual([dugme.ok, dugme.tur], [false, 'gecersiz']);
  const yikici = await o.katman.yuzeydenCalistir('palet', { kimlik: 'button.pc_bilgisayari_kapat', kapat: true });
  assert.equal(yikici.ok, false);
});

test('tepsi: zararsız tıklamada diyalog yok; yıkıcıda diyalog, "Vazgeç" hiçbir istek göndermez, "Çalıştır" tek POST', async () => {
  const o = ortam();
  await o.katman.tepsiTikla('light.ampul');
  assert.equal(o.diyaloglar.length, 0);
  assert.equal(o.postlar().length, 1);

  const vazgec = ortam({ diyalogYaniti: false });
  await vazgec.katman.tepsiTikla('button.pc_bilgisayari_kapat');
  assert.equal(vazgec.diyaloglar.length, 1);
  assert.equal(vazgec.istekler.length, 0, 'vazgeçilince HİÇBİR istek gitmez (durum sorgusu bile)');

  const evet = ortam();
  await evet.katman.tepsiTikla('button.pc_bilgisayari_kapat');
  assert.equal(evet.diyaloglar.length, 1);
  assert.equal(evet.postlar().length, 1);
});

test('tepsi: menü zararsız sandı ama HA\'daki güncel ad onay istiyor -> sonradan sorulur ve tek POST', async () => {
  const o = ortam();
  await o.katman.tepsiTikla('script.gizli_kapat');
  assert.equal(o.diyaloglar.length, 1);
  assert.equal(o.diyaloglar[0][1], 'script.gizli_kapat');
  assert.equal(o.postlar().length, 1);
  const vazgec = ortam({ diyalogYaniti: false });
  await vazgec.katman.tepsiTikla('script.gizli_kapat');
  assert.equal(vazgec.postlar().length, 0);
});

test('tepsi: başka bir onay penceresi açıkken tıklama sessizce yutulmaz (bildirilir) ve hiçbir şey çalışmaz', async () => {
  const o = ortam({ onayAcik: true });
  await o.katman.tepsiTikla('light.ampul');
  assert.equal(o.bekleyenBildirimler.length, 1);
  assert.equal(o.istekler.length, 0);
  await o.katman.tepsiTikla('light.yok_boyle'); // onay açıkken önce uyarı
  assert.equal(o.istekler.length, 0);
});

test('tepsi: favori olmayan kimlik yok sayılır', async () => {
  const o = ortam();
  await o.katman.tepsiTikla('light.favori_degil');
  assert.equal(o.istekler.length, 0);
});

test('güncel durum: canlı bağlantıda depodan (GET yok), canlı değilse REST; depoda "yok" bulunamadı; 404 depoya null yazar', async () => {
  const canli = ortam({ canli: true });
  canli.depo.guncelle(SUNUCU['light.ampul']);
  await canli.katman.yuzeydenCalistir('panel', { kimlik: 'light.ampul' });
  assert.equal(canli.istekler.filter((i) => i.yontem === 'GET').length, 0, 'canlı: durum sorgusu yok');
  assert.equal(canli.postlar().length, 1);

  const bilinmeyen = ortam({ canli: true });
  await bilinmeyen.katman.yuzeydenCalistir('panel', { kimlik: 'light.ampul' });
  assert.equal(bilinmeyen.istekler.filter((i) => i.yontem === 'GET').length, 1, 'depoda yoksa (henüz bilinmiyor) REST');

  const rest = ortam({ canli: false });
  rest.depo.guncelle({ ...SUNUCU['light.ampul'], state: 'on' });
  await rest.katman.yuzeydenCalistir('panel', { kimlik: 'light.ampul' });
  assert.equal(rest.istekler.filter((i) => i.yontem === 'GET').length, 1, 'canlı değil: önbellek güvenilmez, REST');
  assert.equal(rest.depo.al('light.ampul').state, 'off', 'REST yanıtı depoya yazıldı');

  const yok = ortam({ canli: false });
  yok.depo.guncelle({ entity_id: 'light.ampul', state: 'on', attributes: {} });
  const sonuc = await yok.katman.guncelDurum('light.hic_yok');
  assert.equal(sonuc, null);
  assert.equal(yok.depo.al('light.hic_yok'), null);
});

test('GÜVENLİK: canlı depodaki ad sonradan "kapı" olduysa canlı bağlantıda bile eylem durur', async () => {
  const o = ortam({ canli: true });
  o.depo.guncelle({ entity_id: 'light.ampul', state: 'on', attributes: { friendly_name: 'Garaj kapısı' } });
  const s = await o.katman.yuzeydenCalistir('panel', { kimlik: 'light.ampul' });
  assert.deepEqual([s.ok, s.tur], [false, 'yasak']);
  assert.equal(o.postlar().length, 0);
});

test('REST yedeğinde başarıdan 1 sn sonra durum tazelenir; canlı bağlantıda tazeleme yok; hatada hemen tazelenir', async () => {
  const rest = ortam({ canli: false });
  await rest.katman.yuzeydenCalistir('panel', { kimlik: 'light.ampul' });
  assert.equal(rest.zamanlayicilar.length, 1);
  assert.equal(rest.zamanlayicilar[0].ms, REST_SONRASI_YENILEME_MS);
  rest.zamanlayicilar[0].fn();
  await new Promise((coz) => setImmediate(coz));
  assert.equal(rest.yenilemeler.length, 1);

  const canli = ortam({ canli: true });
  canli.depo.guncelle(SUNUCU['light.ampul']);
  await canli.katman.yuzeydenCalistir('panel', { kimlik: 'light.ampul' });
  assert.equal(canli.zamanlayicilar.length, 0);

  const hata = ortam({ canli: false });
  await hata.katman.yuzeydenCalistir('panel', { kimlik: 'light.kapi_lambasi' });
  assert.equal(hata.yenilemeler.length, 1);
});

test('eylemHataMetni: kısa Türkçe metinler; adres/anahtar içermez', () => {
  assert.equal(eylemHataMetni({ tur: 'ha-hatasi', neden: 'baglanti' }), 'bağlantı yok');
  assert.equal(eylemHataMetni({ tur: 'ha-hatasi', neden: 'yetki' }), 'erişim anahtarı geçersiz');
  assert.equal(eylemHataMetni({ tur: 'yasak' }), 'bu cihaz güvenlik nedeniyle engelli');
  assert.equal(eylemHataMetni({ tur: 'ulasilamiyor' }), 'cihaz şu an ulaşılamıyor');
  assert.equal(eylemHataMetni({ tur: 'kaynak-izinsiz' }), 'bu eylem bu yoldan çalıştırılamaz');
  assert.equal(eylemHataMetni({ tur: 'bilinmeyen-favori' }), 'bu eylem favorilerde yok');
  assert.equal(eylemHataMetni({ tur: 'gecersiz' }), 'geçersiz istek');
  assert.equal(eylemHataMetni({ tur: 'baska' }), 'beklenmeyen hata');
  assert.equal(eylemHataMetni(null), 'beklenmeyen hata');
});

test('(tur5-K10) eylem öncesi durum okuması (REST yedeği) kimlikli kapıda "yuksek" öncelikle gider; toplu yenilemenin arkasında beklemez', async () => {
  const o = ortam({ canli: false });
  await o.katman.guncelDurum('light.ampul');
  assert.equal(o.istekler.filter((i) => i.yontem === 'GET').length, 1);
  assert.deepEqual(o.oncelikler, ['yuksek']);
});

// --- 1.4.0: servisCalistir, kayıt kaynakları, kayitliMi ------------------------------------------------------

test('1.4.0 kayıt kaynağı: favori olmayan ama Ayarlar\'da seçilmiş varlık kayıtlı sayılır; kaynak kaldırılınca sayılmaz', async () => {
  SUNUCU['todo.alisveris'] = { entity_id: 'todo.alisveris', state: '2', attributes: {} };
  try {
    const o = ortam();
    assert.equal(o.katman.kayitliMi('todo.alisveris'), false);
    assert.equal(o.katman.kayitliMi('light.ampul'), true, 'favori');
    assert.equal(o.katman.kayitliMi(5), false);
    const kaldir = o.katman.kayitKaynagiEkle((k) => (k === 'todo.alisveris' ? { entity_id: k, ad: 'Alışveriş' } : null));
    o.katman.kayitKaynagiEkle(() => {
      throw new Error('bozuk kaynak');
    });
    o.katman.kayitKaynagiEkle((k) => ({ entity_id: 'baska.kimlik', ad: k }));
    assert.equal(o.katman.kayitliMi('todo.alisveris'), true);
    assert.equal(o.katman.kayitliMi('todo.baska'), false, 'kimliği tutmayan kayıt sayılmaz');
    const s = await o.katman.servisCalistir({ kimlik: 'todo.alisveris', kaynak: 'panel', servis: 'add_item', veri: { item: 'Süt' } });
    assert.equal(s.ok, true);
    assert.deepEqual(o.postlar(), [{ yol: '/api/services/todo/add_item', yontem: 'POST', govde: { entity_id: 'todo.alisveris', item: 'Süt' } }]);
    kaldir();
    assert.equal(o.katman.kayitliMi('todo.alisveris'), false);
    assert.equal((await o.katman.servisCalistir({ kimlik: 'todo.alisveris', kaynak: 'panel', servis: 'add_item', veri: { item: 'Ekmek' } })).tur, 'bilinmeyen-favori');
    assert.equal(o.postlar().length, 1);
    assert.equal(typeof o.katman.kayitKaynagiEkle('islev degil'), 'function');
  } finally {
    delete SUNUCU['todo.alisveris'];
  }
});

test('1.4.0 servisCalistir: yük biçimi ana süreçte de denetlenir (servis deseni, en çok 8 anahtar, 2 KB)', async () => {
  const o = ortam();
  for (const [servis, veri] of [
    ['TURN_ON', undefined],
    ['turn_on;x', undefined],
    [5, undefined],
    ['turn_on', []],
    ['turn_on', null],
    ['turn_on', Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`a${i}`, 1]))],
    ['turn_on', { color_temp_kelvin: 'x'.repeat(3000) }],
  ]) {
    assert.equal((await o.katman.servisCalistir({ kimlik: 'light.ampul', kaynak: 'panel', servis, veri })).tur, 'gecersiz', String(servis));
  }
  const dongusel = {};
  dongusel.kendi = dongusel;
  assert.equal((await o.katman.servisCalistir({ kimlik: 'light.ampul', kaynak: 'panel', servis: 'turn_on', veri: dongusel })).tur, 'gecersiz');
  assert.equal(o.postlar().length, 0);
  assert.equal((await o.katman.servisCalistir({ kimlik: 'light.ampul', kaynak: 'panel', servis: 'turn_off' })).ok, true);
  assert.equal((await o.katman.servisCalistir({ kimlik: 'light.kapi_lambasi', kaynak: 'panel', servis: 'turn_off' })).tur, 'yasak');
  assert.equal(o.postlar().length, 1);
});

// --- 1.4.0 (o-33): masaüstü karosundan eylem -----------------------------------------------------------------------------------------

test('masaustundenCalistir: düz tıklama tek POST (varsayılan servis), kaynak "masaustu"; "Son" listesine girmez; onay penceresi açmaz', async () => {
  const o = ortam();
  const s = await o.katman.masaustundenCalistir({ kimlik: 'light.ampul' });
  assert.deepEqual([s.ok, s.ad], [true, 'Ampul']);
  assert.deepEqual(o.postlar(), [{ yol: '/api/services/light/toggle', yontem: 'POST', govde: { entity_id: 'light.ampul' } }]);
  assert.deepEqual(o.sonlar, [], 'yalnız panel/palet "Son"a yazar');
  assert.deepEqual(o.diyaloglar, []);
  assert.deepEqual(o.bildirimler.map((b) => b.tur), ['ok']);
});

test('masaustundenCalistir: parlaklık ön ayarı tam sayıdır, bildirim verir (sonDeger) ve yalnız favoride "parlaklık" açıkken çalışır', async () => {
  const o = ortam();
  const s = await o.katman.masaustundenCalistir({ kimlik: 'light.led', parlaklik: 50 });
  assert.equal(s.ok, true);
  assert.equal(o.postlar()[0].yol, '/api/services/light/turn_on');
  assert.equal(o.postlar()[0].govde.brightness_pct, 50);
  assert.deepEqual(o.bildirimler.map((b) => b.metin), ['LED şerit: %50'], 'ara değer sayılmaz: son değer bildirilir');
  const kapali = await o.katman.masaustundenCalistir({ kimlik: 'light.ampul', parlaklik: 50 });
  assert.equal(kapali.ok, false, 'favoride parlaklık kapalı: hat reddeder');
  assert.equal(o.postlar().length, 1);
});

test('masaustundenCalistir: tam sayı olmayan/bozuk yük HA\'ya hiç gitmez; ek alanlar (kaynak, servis, veri) yok sayılır', async () => {
  const o = ortam();
  for (const yuk of [null, undefined, [], 'light.ampul', 5, {}, { kimlik: 5 }, { kimlik: 'x'.repeat(121) }, { kimlik: 'light.led', parlaklik: '50' }, { kimlik: 'light.led', parlaklik: 50.5 }, { kimlik: 'light.led', parlaklik: NaN }, { kimlik: 'light.led', parlaklik: null }]) {
    const s = await o.katman.masaustundenCalistir(yuk);
    assert.deepEqual([s.ok, s.tur], [false, 'gecersiz'], JSON.stringify(yuk));
  }
  assert.equal(o.postlar().length, 0);
  const s = await o.katman.masaustundenCalistir({ kimlik: 'light.ampul', kaynak: 'panel', servis: 'turn_off', veri: { brightness: 255 }, eylem: { servis: 'turn_off' }, basili: true, onay: 'diyalog' });
  assert.equal(s.ok, true);
  assert.deepEqual(o.postlar().map((p) => p.yol), ['/api/services/light/toggle'], 'yalnız varsayılan servis; sayfanın verdiği servis/veri kullanılmaz');
  assert.deepEqual(o.postlar()[0].govde, { entity_id: 'light.ampul' });
});

test('masaustundenCalistir: onay isteyen (yıkıcı) eylem ASLA çalışmaz (basılı tutma/onay penceresi yok); kapı kuralı ve favori olmayan kimlik de reddedilir', async () => {
  const o = ortam();
  const yikici = await o.katman.masaustundenCalistir({ kimlik: 'button.pc_bilgisayari_kapat' });
  assert.deepEqual([yikici.ok, yikici.tur], [false, 'kaynak-izinsiz']);
  const gizli = await o.katman.masaustundenCalistir({ kimlik: 'script.gizli_kapat' });
  assert.equal(gizli.ok, false, 'HA\'daki güncel ad yıkıcı');
  const kapi = await o.katman.masaustundenCalistir({ kimlik: 'light.kapi_lambasi' });
  assert.deepEqual([kapi.ok, kapi.tur], [false, 'yasak']);
  for (const kimlik of ['lock.on_kapi', 'cover.garaj', 'alarm_control_panel.ev', 'light.favori_degil']) {
    assert.equal((await o.katman.masaustundenCalistir({ kimlik })).ok, false, kimlik);
  }
  assert.equal(o.postlar().length, 0);
  assert.deepEqual(o.diyaloglar, []);
  const basili = ortam({ zamanSimdi: (() => { let t = 0; return () => (t += 1000); })() });
  basili.katman.basiliBasla('button.pc_bilgisayari_kapat');
  assert.equal((await basili.katman.masaustundenCalistir({ kimlik: 'button.pc_bilgisayari_kapat', basili: true })).ok, false, 'basılı tutma kaydı olsa da masaüstü kaynağı yıkıcıyı çalıştırmaz');
  assert.equal(basili.postlar().length, 0);
});
