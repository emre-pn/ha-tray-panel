'use strict';

/**
 * Tepsi orta tık uygunluğu (1.4.0, o-20; src/lib/orta-tik.js): orta tıkla yalnız ayarda seçilmiş, onay istemeyen, zararsız TEK favori
 * çalışır. Kapı Kuralı'na ve yıkıcı sınıfa takılan hiçbir şey seçilemez ve çalışmaz. Bu dosya saf ön denetimi sınar; gerçek çalıştırma
 * (tek güvenli hat) test/ana-surec.test.js içinde tepsi 'middle-click' olayıyla sınanır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { ORTA_TIK_YASAKLI_ALANLAR, ORTA_TIK_ALANLARI, ortaTikAlaniMi, ortaTikUygunMu } = require('../src/lib/orta-tik');

const favori = (kimlik, ek = {}) => ({ entity_id: kimlik, ad: kimlik, ...ek });

test('orta tık alanları: yalnız zararsız tek tıklama eylemleri; yıkıcı, görüntü ve Kapı Kuralı alanları HİÇBİR koşulda girmez', () => {
  assert.deepEqual([...ORTA_TIK_ALANLARI].sort(), ['button', 'fan', 'humidifier', 'input_boolean', 'input_button', 'light', 'scene', 'script', 'switch']);
  for (const yasak of ['valve', 'automation', 'camera', 'lock', 'alarm_control_panel', 'siren', 'cover', 'climate', 'water_heater', 'update', 'media_player', 'vacuum']) {
    assert.equal(ortaTikAlaniMi(yasak), false, `${yasak} orta tık alanı olmamalı`);
  }
  for (const yasak of ORTA_TIK_YASAKLI_ALANLAR) assert.equal(ORTA_TIK_ALANLARI.includes(yasak), false, `${yasak} yasaklı listede ve alanlarda birlikte`);
  assert.ok(Object.isFrozen(ORTA_TIK_ALANLARI) && Object.isFrozen(ORTA_TIK_YASAKLI_ALANLAR), 'listeler çalışma anında değiştirilemez');
});

test('orta tık uygunluğu: onay istemeyen zararsız favori uygundur', () => {
  for (const kimlik of ['light.salon', 'switch.priz', 'fan.vantilator', 'input_boolean.misafir', 'scene.film', 'humidifier.nem']) {
    assert.deepEqual(ortaTikUygunMu({ kimlik, favori: favori(kimlik) }), { uygun: true }, kimlik);
  }
  assert.deepEqual(ortaTikUygunMu({ kimlik: 'script.aksam', favori: favori('script.aksam', { onay: false }) }), { uygun: true }, 'onayı kullanıcının kapattığı betik: kısayolla aynı kural');
});

test('orta tık uygunluğu: seçilmedi, geçersiz, favori değil, alan dışı, Kapı Kuralı, onaylı — her biri nedeniyle reddedilir', () => {
  assert.deepEqual(ortaTikUygunMu(), { uygun: false, neden: 'secilmedi' });
  assert.deepEqual(ortaTikUygunMu({ kimlik: '', favori: null }), { uygun: false, neden: 'secilmedi' });
  assert.deepEqual(ortaTikUygunMu({ kimlik: null }), { uygun: false, neden: 'secilmedi' });
  assert.deepEqual(ortaTikUygunMu({ kimlik: 5 }), { uygun: false, neden: 'gecersiz' });
  assert.deepEqual(ortaTikUygunMu({ kimlik: '../etc/passwd' }), { uygun: false, neden: 'gecersiz' });
  assert.deepEqual(ortaTikUygunMu({ kimlik: 'light.salon', favori: null }), { uygun: false, neden: 'favori-degil' });
  assert.deepEqual(ortaTikUygunMu({ kimlik: 'light.salon', favori: favori('light.baska') }), { uygun: false, neden: 'favori-degil' }, 'favori kaydı başka bir kimliğe ait');
  for (const kimlik of ['cover.perde', 'valve.su', 'climate.oda', 'automation.gece', 'camera.bahce', 'lock.on_kapi', 'media_player.tv']) {
    assert.deepEqual(ortaTikUygunMu({ kimlik, favori: favori(kimlik) }), { uygun: false, neden: 'alan' }, kimlik);
  }
  assert.deepEqual(ortaTikUygunMu({ kimlik: 'light.garaj_kapisi', favori: favori('light.garaj_kapisi') }), { uygun: false, neden: 'yasak' }, 'kimlikte kapı sözcüğü');
  assert.deepEqual(ortaTikUygunMu({ kimlik: 'light.salon', favori: favori('light.salon', { onay: true }) }), { uygun: false, neden: 'onayli' });
  assert.deepEqual(ortaTikUygunMu({ kimlik: 'script.ak', favori: favori('script.ak') }), { uygun: false, neden: 'onayli' }, 'betik varsayılan olarak onaylıdır');
  assert.deepEqual(ortaTikUygunMu({ kimlik: 'button.pc_kapat', favori: favori('button.pc_kapat') }), { uygun: false, neden: 'onayli' }, 'düğme varsayılan olarak onaylıdır');
});

test('orta tık uygunluğu: HA\'daki GÜNCEL ad kapı/kilit sözcüğü taşıyorsa, kayıtlı ad masum olsa da reddedilir', () => {
  const durum = { entity_id: 'light.salon', attributes: { friendly_name: 'Kapı ışığı' } };
  assert.deepEqual(ortaTikUygunMu({ kimlik: 'light.salon', favori: favori('light.salon', { ad: 'Salon' }), durum }), { uygun: false, neden: 'yasak' });
  const siren = { entity_id: 'switch.priz', attributes: { friendly_name: 'Alarm sireni' } };
  assert.deepEqual(ortaTikUygunMu({ kimlik: 'switch.priz', favori: favori('switch.priz'), durum: siren }), { uygun: false, neden: 'yasak' });
});

test('orta tık uygunluğu: bozuk girdiler fırlatmaz ve uygun saymaz', () => {
  for (const girdi of [undefined, null, 5, 'light.salon', [], { kimlik: {} }, { kimlik: 'light.salon', favori: 'x' }, { kimlik: 'light.salon', favori: [] }, { kimlik: 'light.salon', favori: favori('light.salon'), durum: 7 }]) {
    let sonuc;
    assert.doesNotThrow(() => {
      sonuc = ortaTikUygunMu(girdi);
    });
    if (!(girdi && typeof girdi === 'object' && girdi.favori && typeof girdi.favori === 'object' && girdi.favori.entity_id === 'light.salon')) assert.equal(sonuc.uygun, false);
  }
});
