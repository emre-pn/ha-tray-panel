'use strict';

/**
 * Home Assistant WebSocket protokolü: mesaj kurma ve ayrıştırma (saf; ağ yok) — hiz-03.
 * Belgeli iletiler: auth, subscribe_trigger, subscribe_events, get_states, ping, unsubscribe_events.
 * ('subscribe_entities' belgeli sayılmadığı için KULLANILMAZ.)
 *
 * Güvenlik: erişim anahtarı YALNIZ `authMesaji` içinde geçer; bu modül hiçbir şey günlüğe yazmaz. Sunucudan gelen her
 * şey güvenilmez veri sayılır: tür/biçim doğrulanır, durum nesneleri yalnız bilinen alanlara indirgenir.
 */

const { VARLIK_KIMLIGI_DESENI } = require('./dogrulama');

const EN_COK_MESAJ_BAYT = 4 * 1024 * 1024; // get_states ~400 KB; bunun çok üstü düşman sunucudur

function authMesaji(anahtar) {
  return { type: 'auth', access_token: anahtar };
}

/** Yalnız verilen varlıkların durum (ve öznitelik) değişimini izler: `to`/`from` verilmediği için öznitelik değişimi de tetikler. */
function triggerAboneMesaji(id, kimlikler) {
  return { id, type: 'subscribe_trigger', trigger: { platform: 'state', entity_id: [...kimlikler] } };
}

/** Yedek yol: tüm state_changed olayları (istemci tarafında süzülür). */
function olayAboneMesaji(id) {
  return { id, type: 'subscribe_events', event_type: 'state_changed' };
}

function durumlarMesaji(id) {
  return { id, type: 'get_states' };
}

function pingMesaji(id) {
  return { id, type: 'ping' };
}

function abonelikSilMesaji(id, abonelik) {
  return { id, type: 'unsubscribe_events', subscription: abonelik };
}

/**
 * 1.4.0: canlı bağlantı üzerinden gönderilebilecek YALNIZ OKUYAN komutlar (istek/yanıt). Servis çağrısı (call_service) ve
 * yazan komutlar bu listede YOKTUR ve olmayacaktır: servisler yalnız eylem hattından (REST, tek POST) gider.
 */
const OKUMA_KOMUTLARI = Object.freeze([
  'config/area_registry/list',
  'config/entity_registry/list_for_display',
  'config/device_registry/list',
  'todo/item/list',
  'auth/current_user',
]);
/** 1.4.0: yalnız okuyan abonelikler (olay akışı). */
const ABONELIK_KOMUTLARI = Object.freeze(['persistent_notification/subscribe', 'weather/subscribe_forecast']);
const KOMUT_ALAN_DESENI = /^[a-z_]{1,40}$/;
const KOMUT_BAYT_SINIRI = 1024;

/**
 * 1.4.0: izin listesindeki okuma/abonelik komutunu kurar. Tür listede değilse, `id`/`type` dışında beklenmeyen bir alan adı
 * varsa, değerler düz metin/sayı/mantıksal değilse ya da ileti 1 KB'yi aşıyorsa null.
 * @param {number} id
 * @param {{type: string}} ileti ör. { type: 'todo/item/list', entity_id: 'todo.alisveris' }
 * @param {readonly string[]} [izinli] varsayılan: OKUMA_KOMUTLARI + ABONELIK_KOMUTLARI
 * @returns {object|null}
 */
function komutMesaji(id, ileti, izinli = [...OKUMA_KOMUTLARI, ...ABONELIK_KOMUTLARI]) {
  if (!Number.isInteger(id) || !ileti || typeof ileti !== 'object' || Array.isArray(ileti)) return null;
  if (typeof ileti.type !== 'string' || !izinli.includes(ileti.type)) return null;
  const sonuc = { id, type: ileti.type };
  for (const [ad, deger] of Object.entries(ileti)) {
    if (ad === 'type') continue;
    if (ad === 'id' || !KOMUT_ALAN_DESENI.test(ad)) return null;
    if (!['string', 'number', 'boolean'].includes(typeof deger)) return null;
    if (typeof deger === 'number' && !Number.isFinite(deger)) return null;
    sonuc[ad] = deger;
  }
  return JSON.stringify(sonuc).length <= KOMUT_BAYT_SINIRI ? sonuc : null;
}

/** HA 'result' iletisindeki hata kodu (metin; yoksa 'bilinmeyen'). Hata iletisi (message) bilerek alınmaz. */
function sonucHataKodu(ham) {
  const kod = ham?.error?.code;
  return typeof kod === 'string' && /^[a-z_]{1,40}$/.test(kod) ? kod : 'bilinmeyen';
}

/**
 * Gelen metni çözer.
 * @returns {{ tur: string, id?: number, ham: object }|null} tur: 'auth_required' | 'auth_ok' | 'auth_invalid' |
 *   'result' | 'event' | 'pong' | 'diger'; geçersiz JSON/şekil için null
 */
function mesajCoz(metin) {
  if (typeof metin !== 'string' || metin.length === 0 || metin.length > EN_COK_MESAJ_BAYT) return null;
  let ham;
  try {
    ham = JSON.parse(metin);
  } catch {
    return null;
  }
  if (!ham || typeof ham !== 'object' || Array.isArray(ham) || typeof ham.type !== 'string') return null;
  const bilinen = ['auth_required', 'auth_ok', 'auth_invalid', 'result', 'event', 'pong'];
  const sonuc = { tur: bilinen.includes(ham.type) ? ham.type : 'diger', ham };
  if (Number.isInteger(ham.id)) sonuc.id = ham.id;
  return sonuc;
}

/** HA durum nesnesini yalnız bilinen alanlara indirger; geçersizse null. */
function durumuDuzelt(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  if (typeof d.entity_id !== 'string' || !VARLIK_KIMLIGI_DESENI.test(d.entity_id)) return null;
  if (typeof d.state !== 'string') return null;
  const sonuc = {
    entity_id: d.entity_id,
    state: d.state,
    attributes: d.attributes && typeof d.attributes === 'object' && !Array.isArray(d.attributes) ? d.attributes : {},
  };
  if (typeof d.last_updated === 'string') sonuc.last_updated = d.last_updated;
  if (typeof d.last_changed === 'string') sonuc.last_changed = d.last_changed;
  return sonuc;
}

/**
 * Bir 'event' iletisinden varlık değişimini çıkarır. İki biçim de kabul edilir:
 *  - subscribe_trigger: event.variables.trigger.{entity_id, to_state, from_state}
 *  - subscribe_events:  event.data.{entity_id, new_state, old_state}
 * @returns {{ kimlik: string, yeni: object|null }|null} yeni null = varlık kaldırıldı
 */
function olaydanDurum(mesaj) {
  const olay = mesaj?.ham?.event ?? mesaj?.event;
  if (!olay || typeof olay !== 'object') return null;
  const tetik = olay.variables?.trigger;
  const kaynak = tetik && typeof tetik === 'object' ? { kimlik: tetik.entity_id, yeni: tetik.to_state } : { kimlik: olay.data?.entity_id, yeni: olay.data?.new_state };
  const yeni = durumuDuzelt(kaynak.yeni);
  const kimlik = typeof kaynak.kimlik === 'string' ? kaynak.kimlik : yeni?.entity_id;
  if (typeof kimlik !== 'string' || !VARLIK_KIMLIGI_DESENI.test(kimlik)) return null;
  if (yeni && yeni.entity_id !== kimlik) return null;
  if (!yeni && kaynak.yeni !== null) return null; // yalnız AÇIKÇA null olan kaldırmadır; eksik/bozuk durum yok sayılır
  return { kimlik, yeni };
}

/**
 * get_states sonucunu izlenen kimliklere süzer.
 * @param {unknown} sonuc result iletisinin `result` alanı
 * @param {Set<string>|string[]} izlenen
 * @returns {object[]|null} geçerli durumlar; dizi değilse null
 */
function durumlariSuz(sonuc, izlenen) {
  if (!Array.isArray(sonuc)) return null;
  const kume = izlenen instanceof Set ? izlenen : new Set(izlenen);
  const cikti = [];
  for (const oge of sonuc) {
    if (!oge || typeof oge.entity_id !== 'string' || !kume.has(oge.entity_id)) continue;
    const d = durumuDuzelt(oge);
    if (d) cikti.push(d);
  }
  return cikti;
}

/** http: -> ws:, https: -> wss:; yol /api/websocket. Geçersiz ya da başka protokolse null. */
function websocketAdresi(taban) {
  try {
    const u = new URL(taban);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.protocol === 'https:' ? 'wss:' : 'ws:'}//${u.host}/api/websocket`;
  } catch {
    return null;
  }
}

module.exports = {
  EN_COK_MESAJ_BAYT,
  authMesaji,
  triggerAboneMesaji,
  olayAboneMesaji,
  durumlarMesaji,
  pingMesaji,
  abonelikSilMesaji,
  OKUMA_KOMUTLARI,
  ABONELIK_KOMUTLARI,
  komutMesaji,
  sonucHataKodu,
  mesajCoz,
  durumuDuzelt,
  olaydanDurum,
  durumlariSuz,
  websocketAdresi,
};
