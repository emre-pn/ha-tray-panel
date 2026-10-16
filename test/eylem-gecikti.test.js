'use strict';

/**
 * 1.2.0 (h-09): taze doğrulanmış anahtarla giden servis çağrısının yanıtı gecikirse (HaHatasi 'gecikti') kullanıcıya
 * "Yapılamadı" DENMEZ; "komut gönderildi, yanıt gecikti" denir. Komut yeniden gönderilmez (POST tek kez).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { eylemKatmaniOlustur } = require('../src/eylem');
const { HaHatasi } = require('../src/ha-istemcisi');
const { durumDeposuOlustur } = require('../src/lib/durum-deposu');

const SAHNE = { entity_id: 'scene.uzun', state: 'unknown', attributes: { friendly_name: 'Uzun sahne' } };

function ortam(hataTuru, { canli = true } = {}) {
  const istekler = [];
  const bildirimler = [];
  const yenilemeler = [];
  const sonlar = [];
  const depo = durumDeposuOlustur({ gruplamaMs: 0, zaman: { setTimeout: () => 0, clearTimeout: () => {} } });
  depo.guncelle(SAHNE);
  const katman = eylemKatmaniOlustur({
    ayarlarAl: () => ({ favoriler: [{ entity_id: 'scene.uzun', ad: 'Uzun sahne' }] }),
    depo,
    canliMi: () => canli,
    haIstek: async (yol, secenek = {}) => {
      istekler.push({ yol, yontem: secenek.yontem ?? 'GET' });
      if (secenek.yontem === 'POST') throw new HaHatasi(hataTuru);
      return SAHNE;
    },
    son: { ekle: (k) => sonlar.push(k) },
    geriBildirim: (b) => bildirimler.push(b),
    durumlariYenile: async () => {
      yenilemeler.push(1);
    },
    onayDiyalogu: async () => true,
    onayAcikMi: () => false,
    onayBekleniyorBildir: () => {},
    karolariAl: () => [],
    gunluk: () => {},
    zaman: { setTimeout: () => 0 },
  });
  return { katman, istekler, bildirimler, yenilemeler, sonlar };
}

test('h-09: geciken servis çağrısı "Yapılamadı" değil "komut gönderildi, yanıt gecikti" bildirir; POST tek kez, "Son"a girmez', async () => {
  const o = ortam('gecikti');
  const sonuc = await o.katman.yuzeydenCalistir('panel', { kimlik: 'scene.uzun' });
  assert.equal(sonuc.ok, false);
  assert.equal(o.istekler.filter((i) => i.yontem === 'POST').length, 1, 'komut yeniden gönderilmez');
  assert.equal(o.bildirimler.length, 1);
  assert.equal(o.bildirimler[0].tur, 'ok');
  assert.equal(o.bildirimler[0].metin, 'Uzun sahne: komut gönderildi, yanıt gecikti');
  assert.doesNotMatch(o.bildirimler[0].metin, /Yapılamadı/);
  assert.deepEqual(o.sonlar, []);
});

test('h-09: REST yedeğinde geciken çağrıdan sonra durum tazelenir; diğer hatalar eskisi gibi "Yapılamadı"', async () => {
  const yedek = ortam('gecikti', { canli: false });
  await yedek.katman.yuzeydenCalistir('panel', { kimlik: 'scene.uzun' });
  assert.equal(yedek.yenilemeler.length, 1);
  const belirsiz = ortam('belirsiz');
  await belirsiz.katman.yuzeydenCalistir('panel', { kimlik: 'scene.uzun' });
  assert.equal(belirsiz.bildirimler[0].tur, 'hata');
  assert.match(belirsiz.bildirimler[0].metin, /^Yapılamadı: Home Assistant yanıt vermedi/);
});
