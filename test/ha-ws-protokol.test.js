'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const p = require('../src/lib/ha-ws-protokol');

test('mesaj kurucular: yalnız belgeli ileti türleri; anahtar yalnız auth iletisinde', () => {
  assert.deepEqual(p.authMesaji('TOKEN'), { type: 'auth', access_token: 'TOKEN' });
  assert.deepEqual(p.triggerAboneMesaji(2, ['light.a', 'switch.b']), {
    id: 2,
    type: 'subscribe_trigger',
    trigger: { platform: 'state', entity_id: ['light.a', 'switch.b'] },
  });
  assert.deepEqual(p.olayAboneMesaji(3), { id: 3, type: 'subscribe_events', event_type: 'state_changed' });
  assert.deepEqual(p.durumlarMesaji(4), { id: 4, type: 'get_states' });
  assert.deepEqual(p.pingMesaji(5), { id: 5, type: 'ping' });
  assert.deepEqual(p.abonelikSilMesaji(6, 2), { id: 6, type: 'unsubscribe_events', subscription: 2 });
  for (const m of [p.triggerAboneMesaji(2, []), p.olayAboneMesaji(3), p.durumlarMesaji(4), p.pingMesaji(5), p.abonelikSilMesaji(6, 2)]) {
    assert.ok(!JSON.stringify(m).includes('access_token'));
    assert.notEqual(m.type, 'subscribe_entities', 'belgesiz subscribe_entities kullanılmaz');
  }
});

test('mesajCoz: bilinen türler, id; bozuk/aşırı büyük/yanlış şekil null', () => {
  assert.equal(p.mesajCoz('{"type":"auth_required","ha_version":"2026.10"}').tur, 'auth_required');
  assert.equal(p.mesajCoz('{"type":"auth_ok"}').tur, 'auth_ok');
  assert.equal(p.mesajCoz('{"type":"auth_invalid","message":"x"}').tur, 'auth_invalid');
  const sonuc = p.mesajCoz('{"id":7,"type":"result","success":true,"result":[]}');
  assert.equal(sonuc.tur, 'result');
  assert.equal(sonuc.id, 7);
  assert.equal(p.mesajCoz('{"id":8,"type":"pong"}').tur, 'pong');
  assert.equal(p.mesajCoz('{"id":2,"type":"event","event":{}}').tur, 'event');
  assert.equal(p.mesajCoz('{"type":"baska"}').tur, 'diger');
  assert.equal(p.mesajCoz('{"id":"7","type":"result"}').id, undefined, 'tamsayı olmayan id yok sayılır');
  assert.equal(p.mesajCoz('{bozuk'), null);
  assert.equal(p.mesajCoz(''), null);
  assert.equal(p.mesajCoz(null), null);
  assert.equal(p.mesajCoz('[1,2]'), null);
  assert.equal(p.mesajCoz('{"type":5}'), null);
  assert.equal(p.mesajCoz(`{"type":"result","x":"${'a'.repeat(p.EN_COK_MESAJ_BAYT)}"}`), null);
});

test('durumuDuzelt: yalnız bilinen alanlar kalır; bozuk girdi null', () => {
  const d = p.durumuDuzelt({
    entity_id: 'light.a',
    state: 'on',
    attributes: { brightness: 10 },
    last_updated: '2026-10-06T10:00:00+00:00',
    last_changed: '2026-10-06T10:00:00+00:00',
    context: { id: 'gizli' },
    ekstra: 1,
  });
  assert.deepEqual(Object.keys(d).sort(), ['attributes', 'entity_id', 'last_changed', 'last_updated', 'state']);
  assert.deepEqual(p.durumuDuzelt({ entity_id: 'light.a', state: 'on', attributes: [1] }).attributes, {});
  assert.equal(p.durumuDuzelt(null), null);
  assert.equal(p.durumuDuzelt({ entity_id: 'KÖTÜ', state: 'on' }), null);
  assert.equal(p.durumuDuzelt({ entity_id: 'light.a', state: 5 }), null);
  assert.equal(p.durumuDuzelt([]), null);
});

test('olaydanDurum: subscribe_trigger ve subscribe_events biçimlerinin ikisi de çözülür', () => {
  const tetik = p.mesajCoz(
    JSON.stringify({
      id: 2,
      type: 'event',
      event: { variables: { trigger: { platform: 'state', entity_id: 'light.a', from_state: null, to_state: { entity_id: 'light.a', state: 'on', attributes: { brightness: 255 } } } } },
    }),
  );
  assert.deepEqual(p.olaydanDurum(tetik).yeni.state, 'on');
  assert.equal(p.olaydanDurum(tetik).kimlik, 'light.a');

  const olay = p.mesajCoz(
    JSON.stringify({ id: 2, type: 'event', event: { event_type: 'state_changed', data: { entity_id: 'light.b', new_state: { entity_id: 'light.b', state: 'off', attributes: {} } } } }),
  );
  assert.equal(p.olaydanDurum(olay).kimlik, 'light.b');
  assert.equal(p.olaydanDurum(olay).yeni.state, 'off');
});

test('olaydanDurum: açıkça null yeni durum kaldırma sayılır; eksik/bozuk/uyuşmayan durum yok sayılır', () => {
  const kaldir = p.mesajCoz(JSON.stringify({ id: 2, type: 'event', event: { data: { entity_id: 'light.a', new_state: null } } }));
  assert.deepEqual(p.olaydanDurum(kaldir), { kimlik: 'light.a', yeni: null });
  const eksik = p.mesajCoz(JSON.stringify({ id: 2, type: 'event', event: { data: { entity_id: 'light.a' } } }));
  assert.equal(p.olaydanDurum(eksik), null, 'to_state yoksa kaldırma sayılmaz');
  const bozuk = p.mesajCoz(JSON.stringify({ id: 2, type: 'event', event: { data: { entity_id: 'light.a', new_state: { entity_id: 'light.a', state: 5 } } } }));
  assert.equal(p.olaydanDurum(bozuk), null);
  const uyusmaz = p.mesajCoz(JSON.stringify({ id: 2, type: 'event', event: { data: { entity_id: 'light.a', new_state: { entity_id: 'light.z', state: 'on' } } } }));
  assert.equal(p.olaydanDurum(uyusmaz), null);
  assert.equal(p.olaydanDurum(p.mesajCoz('{"id":1,"type":"event","event":{}}')), null);
  assert.equal(p.olaydanDurum(null), null);
});

test('durumlariSuz: yalnız izlenen kimlikler, bozuklar atılır; dizi değilse null', () => {
  const tum = [
    { entity_id: 'light.a', state: 'on', attributes: {} },
    { entity_id: 'light.baska', state: 'on', attributes: {} },
    { entity_id: 'switch.a', state: 5 },
    null,
  ];
  const suzulen = p.durumlariSuz(tum, new Set(['light.a', 'switch.a']));
  assert.deepEqual(suzulen.map((d) => d.entity_id), ['light.a']);
  assert.equal(p.durumlariSuz(tum, ['light.a']).length, 1, 'dizi de kabul edilir');
  assert.equal(p.durumlariSuz({}, ['light.a']), null);
  assert.equal(p.durumlariSuz(null, []), null);
});

test('websocketAdresi: http -> ws, https -> wss, yol /api/websocket; yol/sorgu atılır; başka protokol null', () => {
  assert.equal(p.websocketAdresi('http://192.168.1.10:8123'), 'ws://192.168.1.10:8123/api/websocket');
  assert.equal(p.websocketAdresi('https://ev.example.com'), 'wss://ev.example.com/api/websocket');
  assert.equal(p.websocketAdresi('https://ev.example.com/yol?x=1#y'), 'wss://ev.example.com/api/websocket');
  assert.equal(p.websocketAdresi('ftp://x'), null);
  assert.equal(p.websocketAdresi('file:///c:/x'), null);
  assert.equal(p.websocketAdresi('düz metin'), null);
  assert.equal(p.websocketAdresi(undefined), null);
});

test('o-61: mobile_app bildirim kanalı abonelik listesinde; yalnız düz alanlar (webhook_id, support_confirm), yazan komutlar yine yok', () => {
  assert.ok(p.ABONELIK_KOMUTLARI.includes('mobile_app/push_notification_channel'));
  assert.deepEqual(p.komutMesaji(7, { type: 'mobile_app/push_notification_channel', webhook_id: 'ab12cd34ef56ab12cd34ef56ab12cd34', support_confirm: false }), {
    id: 7,
    type: 'mobile_app/push_notification_channel',
    webhook_id: 'ab12cd34ef56ab12cd34ef56ab12cd34',
    support_confirm: false,
  });
  assert.equal(p.komutMesaji(7, { type: 'mobile_app/push_notification_channel', webhook_id: { ic: 1 } }), null, 'nesne değer reddedilir');
  assert.equal(p.komutMesaji(7, { type: 'mobile_app/push_notification_channel', 'webhook-id': 'x' }), null, 'alan adı deseni');
  assert.equal(p.komutMesaji(7, { type: 'mobile_app/webhook/fire' }), null);
  assert.equal(p.komutMesaji(7, { type: 'call_service', domain: 'light' }), null);
  assert.ok(!p.OKUMA_KOMUTLARI.includes('mobile_app/push_notification_channel'), 'okuma (istek/yanıt) listesine girmez: bir abonelik');
});
