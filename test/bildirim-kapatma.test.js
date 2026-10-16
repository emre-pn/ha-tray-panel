'use strict';

/**
 * Bildirim grubu (1.4.0; o-36, o-37, o-39) alt katman sözleşmeleri: varlıksız servis doğrulama, bildirim kapatma hattı (tek POST noktası,
 * yalnız panel kaynağı, hız sınırı, kayıtlı bildirim), eylem katmanındaki sarmalayıcı, uyarı kuralı alanlarının Kapı Kuralı uyumu ve
 * ha-okuma bildirim aboneliğindeki "gizlenen" sayısı. Gerçek HA'ya hiç gidilmez: sahte haIstek / ws.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { varliksizServisDogrula, VARLIKSIZ_SERVISLER, BILDIRIM_KIMLIGI_DESENI, izinliServisler } = require('../src/lib/servis-izinleri');
const { bildirimKapatHattiOlustur, hizSiniriOlustur, BILDIRIM_ORAN_SINIRI } = require('../src/lib/eylem-hatti');
const { eylemKatmaniOlustur } = require('../src/eylem');
const { durumDeposuOlustur } = require('../src/lib/durum-deposu');
const { UYARI_ALANLARI, alanSimgesi, ALAN_SIMGELERI } = require('../src/lib/uyari-kurallari');
const { karoAlaniMi } = require('../src/lib/alan-kaydi');
const { haOkumaOlustur } = require('../src/lib/ha-okuma');

// ---------------------------------------------------------------------------
// servis-izinleri: varlıksız servis
// ---------------------------------------------------------------------------

test('varliksizServisDogrula: yalnız persistent_notification.dismiss ve geçerli kimlikle kabul edilir; gövde yalnız notification_id', () => {
  assert.deepEqual(varliksizServisDogrula('persistent_notification', 'dismiss', { notification_id: 'camasir-bitti_1' }), {
    ok: true,
    govde: { notification_id: 'camasir-bitti_1' },
    sinif: 'zararsiz',
  });
  assert.deepEqual(Object.keys(VARLIKSIZ_SERVISLER), ['persistent_notification']);
  assert.deepEqual(Object.keys(VARLIKSIZ_SERVISLER.persistent_notification), ['dismiss']);
  assert.ok(Object.isFrozen(VARLIKSIZ_SERVISLER) && Object.isFrozen(VARLIKSIZ_SERVISLER.persistent_notification));
  assert.deepEqual(izinliServisler('persistent_notification'), [], 'varlıklı servis tablosuna girmez (entity_id ile çağrılamaz)');
});

test('varliksizServisDogrula: bilinmeyen alan/servis, kapı alanları, fazla ya da eksik parametre, bozuk kimlik ve düz olmayan nesne reddedilir', () => {
  const ret = (...a) => varliksizServisDogrula(...a);
  const gecerli = { notification_id: 'a' };
  for (const [alan, servis] of [
    ['persistent_notification', 'create'],
    ['persistent_notification', 'dismiss_all'],
    ['persistent_notification', 'mark_read'],
    ['persistent_notification', '__proto__'],
    ['persistent_notification', 'constructor'],
    ['persistent_notification', 'DISMISS'],
    ['lock', 'unlock'],
    ['cover', 'open_cover'],
    ['alarm_control_panel', 'alarm_disarm'],
    ['siren', 'turn_on'],
    ['notify', 'notify'],
    ['homeassistant', 'restart'],
    ['__proto__', 'dismiss'],
    ['constructor', 'dismiss'],
    [null, 'dismiss'],
    ['persistent_notification', 5],
  ]) {
    assert.deepEqual(ret(alan, servis, gecerli), { ok: false, neden: 'servis' }, `${alan}.${servis}`);
  }
  assert.equal(ret('persistent_notification', 'dismiss', {}).neden, 'eksik');
  assert.equal(ret('persistent_notification', 'dismiss', undefined).neden, 'eksik');
  assert.equal(ret('persistent_notification', 'dismiss', { notification_id: undefined }).neden, 'eksik');
  assert.equal(ret('persistent_notification', 'dismiss', { notification_id: 'a', entity_id: 'lock.on_kapi' }).neden, 'parametre', 'fazladan anahtar gönderilemez');
  assert.equal(ret('persistent_notification', 'dismiss', { notification_id: 'a', fazla: 1 }).parametre, 'fazla');
  for (const kotu of ['', 'a b', 'a/b', '../etc', 'a?x=1', '<img>', 'ö', 'a'.repeat(101), 5, null, ['a'], { toString: () => 'a' }, true]) {
    assert.equal(ret('persistent_notification', 'dismiss', { notification_id: kotu }).ok, false, String(kotu));
  }
  for (const kotu of [null, [], 'x', 5, new Date(), Object.create({ notification_id: 'a' })]) {
    assert.equal(ret('persistent_notification', 'dismiss', kotu).ok, false, String(kotu));
  }
  assert.ok(BILDIRIM_KIMLIGI_DESENI.test('a'.repeat(100)) && !BILDIRIM_KIMLIGI_DESENI.test('a'.repeat(101)));
});

// ---------------------------------------------------------------------------
// eylem-hatti: bildirim kapatma
// ---------------------------------------------------------------------------

function hatOrtami({ kayitli = ['n1', 'n2'], hata = null, simdi = () => 5000 } = {}) {
  const cagrilar = [];
  const hat = bildirimKapatHattiOlustur({
    bildirimKayitliMi: (k) => kayitli.includes(k),
    haIstek: async (yol, secenek) => {
      cagrilar.push({ yol, ...secenek });
      if (hata) throw hata;
      return [];
    },
    hizSiniri: hizSiniriOlustur({ simdi }),
  });
  return { hat, cagrilar };
}

test('bildirim kapatma hattı: panelden kayıtlı bildirim tek POST ile kapanır (persistent_notification/dismiss, yalnız notification_id)', async () => {
  const { hat, cagrilar } = hatOrtami();
  assert.deepEqual(await hat({ kimlik: 'n1', kaynak: 'panel' }), { ok: true, sinif: 'zararsiz' });
  assert.deepEqual(cagrilar, [{ yol: '/api/services/persistent_notification/dismiss', yontem: 'POST', govde: { notification_id: 'n1' } }]);
});

test('bildirim kapatma hattı: panel dışındaki kaynaklar (palet, kısayol, komut satırı, tepsi, bilinmeyen) reddedilir; POST gitmez', async () => {
  const { hat, cagrilar } = hatOrtami();
  for (const kaynak of ['palet', 'kisayol', 'komut-satiri', 'tepsi', 'ayarlar', '', undefined, null, 5]) {
    assert.deepEqual(await hat({ kimlik: 'n1', kaynak }), { ok: false, tur: 'kaynak-izinsiz' }, String(kaynak));
  }
  for (const istek of [undefined, null, 'n1', 5, []]) assert.equal((await hat(istek)).ok, false);
  assert.equal(cagrilar.length, 0);
});

test('bildirim kapatma hattı: bozuk kimlik, panelde gösterilmeyen (süzgeçte elenen, uydurma) kimlik reddedilir; POST gitmez', async () => {
  const { hat, cagrilar } = hatOrtami();
  for (const kimlik of ['', 'a b', '../x', 'a'.repeat(101), 5, null, undefined, { a: 1 }]) {
    const s = await hat({ kimlik, kaynak: 'panel' });
    assert.equal(s.ok, false);
    assert.equal(s.tur, 'gecersiz', String(kimlik));
  }
  assert.deepEqual(await hat({ kimlik: 'garaj-kapisi-acik', kaynak: 'panel' }), { ok: false, tur: 'bilinmeyen-bildirim' }, 'Kapı Kuralı ile elenen bildirim panelde yok: kapatılamaz');
  assert.equal(cagrilar.length, 0);
});

test('bildirim kapatma hattı: saniyede en çok 4 çağrı; sonrası "çok sık", pencere geçince yeniden izin', async () => {
  let t = 1000;
  const { hat, cagrilar } = hatOrtami({ kayitli: ['n1'], simdi: () => t });
  assert.equal(BILDIRIM_ORAN_SINIRI, 4);
  for (let i = 0; i < BILDIRIM_ORAN_SINIRI; i += 1) assert.equal((await hat({ kimlik: 'n1', kaynak: 'panel' })).ok, true);
  assert.deepEqual(await hat({ kimlik: 'n1', kaynak: 'panel' }), { ok: false, tur: 'cok-sik' });
  assert.equal(cagrilar.length, 4);
  t += 1500;
  assert.equal((await hat({ kimlik: 'n1', kaynak: 'panel' })).ok, true);
  assert.equal(cagrilar.length, 5);
});

test('bildirim kapatma hattı: HA hatası ayrıntıyla döner ve istek asla yeniden denenmez; yetki kesici hatası da aynı yoldan geçer', async () => {
  const ag = hatOrtami({ hata: Object.assign(new Error('x'), { tur: 'ag' }) });
  const s = await ag.hat({ kimlik: 'n1', kaynak: 'panel' });
  assert.equal(s.ok, false);
  assert.equal(s.tur, 'ha-hatasi');
  assert.equal(ag.cagrilar.length, 1, 'yeniden deneme yok');
  assert.doesNotMatch(JSON.stringify(s), /token|Bearer/i);
  const red = hatOrtami({ hata: Object.assign(new Error('x'), { tur: 'yetki-kesici', durumKodu: 401 }) });
  const r = await red.hat({ kimlik: 'n1', kaynak: 'panel' });
  assert.equal(r.ok, false);
  assert.equal(r.durumKodu, 401);
});

// ---------------------------------------------------------------------------
// eylem katmanı: bildirimKapat
// ---------------------------------------------------------------------------

function katmanOrtami({ kayitli = ['n1'], hata = null } = {}) {
  const istekler = [];
  const bildirimler = [];
  const gunlukler = [];
  const depo = durumDeposuOlustur({ gruplamaMs: 0, zaman: { setTimeout: () => 0, clearTimeout: () => {} } });
  const katman = eylemKatmaniOlustur({
    ayarlarAl: () => ({ favoriler: [] }),
    depo,
    canliMi: () => false,
    haIstek: async (yol, secenek = {}) => {
      istekler.push({ yol, yontem: secenek.yontem ?? 'GET', govde: secenek.govde });
      if (hata) throw hata;
      return [];
    },
    son: { ekle: () => {} },
    geriBildirim: (b) => bildirimler.push(b),
    durumlariYenile: async () => {},
    onayDiyalogu: async () => true,
    onayAcikMi: () => false,
    onayBekleniyorBildir: () => {},
    karolariAl: () => [],
    bildirimKayitliMi: (k) => kayitli.includes(k),
    gunluk: (m) => gunlukler.push(m),
    zaman: { setTimeout: () => 0 },
    simdi: () => 1000,
  });
  return { katman, istekler, bildirimler, gunlukler };
}

test('eylem.bildirimKapat: kayıtlı bildirim kapanır, tek POST gider, başarı sessizdir (şerit kendini günceller)', async () => {
  const o = katmanOrtami();
  assert.deepEqual(await o.katman.bildirimKapat('n1'), { ok: true });
  assert.deepEqual(o.istekler, [{ yol: '/api/services/persistent_notification/dismiss', yontem: 'POST', govde: { notification_id: 'n1' } }]);
  assert.deepEqual(o.bildirimler, []);
});

test('eylem.bildirimKapat: kayıtlı olmayan ya da bozuk kimlik POST göndermez ve hata bildirimi gösterir; dönüş türü korunur', async () => {
  const o = katmanOrtami();
  assert.deepEqual(await o.katman.bildirimKapat('baska'), { ok: false, tur: 'bilinmeyen-bildirim' });
  assert.deepEqual(await o.katman.bildirimKapat('../x'), { ok: false, tur: 'gecersiz' });
  assert.deepEqual(await o.katman.bildirimKapat(undefined), { ok: false, tur: 'gecersiz' });
  assert.equal(o.istekler.length, 0);
  assert.deepEqual(o.bildirimler.map((b) => b.tur), ['hata', 'hata', 'hata']);
  assert.ok(o.gunlukler.some((m) => /Bildirim kapatılamadı: bilinmeyen-bildirim/.test(m)));
});

test('eylem.bildirimKapat: HA hatasında hata bildirimi gösterilir; "çok sık" yanıtı sessizdir', async () => {
  const hatali = katmanOrtami({ hata: Object.assign(new Error('x'), { tur: 'ag' }) });
  const s = await hatali.katman.bildirimKapat('n1');
  assert.deepEqual([s.ok, s.tur], [false, 'ha-hatasi']);
  assert.equal(hatali.bildirimler.length, 1);
  assert.equal(hatali.bildirimler[0].tur, 'hata');

  const sik = katmanOrtami();
  for (let i = 0; i < 4; i += 1) assert.equal((await sik.katman.bildirimKapat('n1')).ok, true);
  assert.deepEqual(await sik.katman.bildirimKapat('n1'), { ok: false, tur: 'cok-sik' });
  assert.equal(sik.bildirimler.length, 0, 'çok sık: uyarı bildirimi yağmuru yok');
  assert.equal(sik.istekler.length, 4);
});

// ---------------------------------------------------------------------------
// Uyarı kuralı alanları ve Kapı Kuralı
// ---------------------------------------------------------------------------

test('UYARI_ALANLARI: hepsi karo olabilen alan; kapı/kilit/alarm/siren/kepenk/kamera/takvim/yapılacak/düğme/sahne yok; her alanın simgesi var', () => {
  for (const alan of UYARI_ALANLARI) assert.equal(karoAlaniMi(alan), true, `${alan}: alan kaydında karo olabilen alan değil`);
  for (const yasak of ['lock', 'cover', 'alarm_control_panel', 'siren', 'camera', 'valve', 'calendar', 'todo', 'button', 'scene', 'script', 'automation', 'update', 'person', 'device_tracker']) {
    assert.ok(!UYARI_ALANLARI.includes(yasak), `${yasak} uyarı kuralı alanı olamaz`);
  }
  for (const alan of UYARI_ALANLARI) assert.ok(Object.hasOwn(ALAN_SIMGELERI, alan), `${alan}: simge yok`);
  assert.equal(alanSimgesi('lock'), '🔔', 'bilinmeyen alan zil simgesi alır');
  assert.equal(alanSimgesi('__proto__'), '🔔');
  assert.equal(alanSimgesi(undefined), '🔔');
});

// ---------------------------------------------------------------------------
// ha-okuma: bildirim aboneliği, "gizlenen" sayısı
// ---------------------------------------------------------------------------

test('bildirimAboneOl: dinleyicinin ikinci bağımsız değişkeni "gizlenen" sayısıdır (içerik yok); kaldırma ve yeni liste sayıyı günceller', () => {
  const aboneler = [];
  const ws = { abone: (ileti, dinleyici) => (aboneler.push({ ileti, dinleyici }), () => {}), komut: async () => ({ ok: false }) };
  const okuma = haOkumaOlustur({ haIstek: async () => [], ws, gunluk: () => {} });
  const gelen = [];
  okuma.bildirimAboneOl((liste, ek) => gelen.push({ liste, ek }));
  const ver = (olay) => aboneler[0].dinleyici({ olay });
  ver({
    type: 'current',
    notifications: {
      a: { notification_id: 'a', title: 'Güncelleme', message: 'Yeni sürüm var', created_at: '2026-10-16T10:00:00+00:00' },
      b: { notification_id: 'b', message: 'Garaj kapısı açık kaldı' },
      c: { notification_id: 'c', title: 'Front door', message: 'ok' },
      d: { notification_id: 'd', message: 'Alarm devrede' },
    },
  });
  assert.deepEqual(gelen.at(-1).liste.map((b) => b.id), ['a']);
  assert.deepEqual(gelen.at(-1).ek, { gizlenen: 3 });
  assert.doesNotMatch(JSON.stringify(gelen.at(-1)), /Garaj|Front|Alarm/, 'gizlenen bildirimin içeriği dinleyiciye hiç gitmez');
  ver({ type: 'removed', notifications: { b: { notification_id: 'b' } } });
  assert.deepEqual(gelen.at(-1).ek, { gizlenen: 2 }, 'HA gizli bildirimi kaldırınca sayı düşer');
  ver({ type: 'updated', notifications: { c: { notification_id: 'c', title: 'Bilgi', message: 'Temiz metin' } } });
  assert.deepEqual(gelen.at(-1).liste.map((b) => b.id).sort(), ['a', 'c']);
  assert.deepEqual(gelen.at(-1).ek, { gizlenen: 1 }, 'metni düzelen bildirim görünür olur, sayıdan çıkar');
  ver({ type: 'current', notifications: {} });
  assert.deepEqual(gelen.at(-1), { liste: [], ek: { gizlenen: 0 } }, 'tam liste her şeyi sıfırlar');
});

test('bildirimAboneOl: WS yoksa ya da dinleyici işlev değilse hiçbir şey kurulmaz; dinleyici hatası aboneliği bozmaz', () => {
  const okumaYok = haOkumaOlustur({ haIstek: async () => [], ws: null, gunluk: () => {} });
  assert.equal(typeof okumaYok.bildirimAboneOl(() => {}), 'function');
  const aboneler = [];
  const ws = { abone: (ileti, dinleyici) => (aboneler.push({ ileti, dinleyici }), () => {}), komut: async () => ({ ok: false }) };
  const okuma = haOkumaOlustur({ haIstek: async () => [], ws, gunluk: () => {} });
  okuma.bildirimAboneOl('dinleyici değil');
  assert.equal(aboneler.length, 0);
  okuma.bildirimAboneOl(() => {
    throw new Error('dinleyici patladı');
  });
  assert.doesNotThrow(() => aboneler[0].dinleyici({ olay: { type: 'current', notifications: { a: { notification_id: 'a', message: 'x' } } } }));
});
