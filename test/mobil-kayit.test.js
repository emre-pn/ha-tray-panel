'use strict';

/**
 * o-61: HA mobile_app kaydı, itme kanalı ve bildirim eylemleri (src/lib/mobil-kayit.js; saf, her şey sahte).
 * Gerçek HA, gerçek ağ, gerçek webhook kimliği ve safeStorage yok: depo/ws/haIstek/webhookGonder sahtedir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  KAYIT_YOLU,
  OLAY_TURU,
  KANAL_KOMUTU,
  CIHAZ_ADI_VARSAYILAN,
  CIHAZ_ADI_SINIRI,
  EN_COK_GELEN,
  EN_COK_GIDEN,
  GIDEN_ARALIK_MS,
  webhookKimligiGecerliMi,
  cihazAdiDuzelt,
  kayitGovdesi,
  eylemGovdesi,
  webhookGovdesiGecerliMi,
  mobilKayitOlustur,
} = require('../src/lib/mobil-kayit');

const WEBHOOK = '0123456789abcdef0123456789abcdef'; // sahte
const KIMLIK = { uygulamaKimligi: 'tr.test.evpaneli', uygulamaAdi: 'Ev Paneli', surum: '1.4.0', osSurumu: '10.0.26300' };

function sahteDepo({ kullanilabilir = true, baslangic = null, yazHatasi = false, okumaHatasi = false } = {}) {
  let deger = baslangic;
  return {
    deger: () => deger,
    varMi: () => deger !== null,
    kullanilabilirMi: async () => kullanilabilir,
    anahtarAl: async () => {
      if (okumaHatasi) throw new Error('okunamadi');
      return deger;
    },
    yaz: async (k) => {
      if (yazHatasi) throw new Error('yazilamadi');
      deger = k;
    },
    sil: async () => {
      const vardi = deger !== null;
      deger = null;
      return { silindi: vardi };
    },
  };
}

function sahteWs() {
  const abonelikler = [];
  let canli = true;
  return {
    abonelikler,
    canliAyarla: (d) => {
      canli = d;
    },
    abone(ileti, dinleyici) {
      const kayit = { ileti, dinleyici, birakildi: false };
      abonelikler.push(kayit);
      return () => {
        kayit.birakildi = true;
      };
    },
    canliMi: () => canli,
    aktifler: () => abonelikler.filter((a) => !a.birakildi),
  };
}

function kur({ depo = sahteDepo(), etkin = true, cihazAdi = 'Salon PC', haIstek, webhookGonder, ws = sahteWs(), baslangicMs = 1_000_000 } = {}) {
  const durum = { etkin, cihazAdi, an: baslangicMs };
  const kayit = {
    istekler: [],
    webhooklar: [],
    gosterilen: [],
    temizlenen: [],
    uyarilar: [],
    gunlukler: [],
    degisimler: 0,
  };
  const mobil = mobilKayitOlustur({
    haIstek:
      haIstek ??
      (async (yol, secenek) => {
        kayit.istekler.push({ yol, secenek });
        return { webhook_id: WEBHOOK, cloudhook_url: null, remote_ui_url: null };
      }),
    webhookGonder:
      webhookGonder ??
      (async (kimlik, govde) => {
        kayit.webhooklar.push({ kimlik, govde });
        return { durum: 200 };
      }),
    depo,
    ws,
    etkinMi: () => durum.etkin,
    cihazAdiAl: () => durum.cihazAdi,
    kimlik: KIMLIK,
    goster: (b) => kayit.gosterilen.push(b),
    temizle: (e) => kayit.temizlenen.push(e),
    uyari: (t) => kayit.uyarilar.push(t),
    durumDegisti: () => {
      kayit.degisimler += 1;
    },
    simdi: () => durum.an,
    gunluk: (m) => kayit.gunlukler.push(m),
  });
  return { mobil, depo, ws, durum, kayit };
}

const olay = (message, ek = {}) => ({ message, ...ek });
const bekle = () => new Promise((coz) => setImmediate(coz));

// --- saf yardımcılar ----------------------------------------------------------------

test('webhook kimliği biçimi: 16-128 karakter, harf/rakam/_/- ; yol kaçışları ve boşluk reddedilir', () => {
  for (const iyi of [WEBHOOK, 'A'.repeat(64), 'abc_def-ghi_jkl-mno']) assert.equal(webhookKimligiGecerliMi(iyi), true, iyi);
  for (const kotu of ['', 'kisa', 'a'.repeat(15), 'a'.repeat(129), `${WEBHOOK}/x`, `${WEBHOOK}?a`, `${WEBHOOK} `, '../' + WEBHOOK, 'a b'.repeat(10), null, undefined, 5, {}]) assert.equal(webhookKimligiGecerliMi(kotu), false, String(kotu));
});

test('cihaz adı: kontrol karakterleri atılır, 40 karaktere kısalır, boşsa "Ev Paneli"', () => {
  assert.equal(cihazAdiDuzelt('  Salon   PC \n'), 'Salon PC');
  assert.equal(cihazAdiDuzelt('a\u0000b\u007Fc'), 'a b c');
  assert.equal(cihazAdiDuzelt('x'.repeat(100)).length, CIHAZ_ADI_SINIRI);
  for (const bos of ['', '   ', null, undefined, 5, {}]) assert.equal(cihazAdiDuzelt(bos), CIHAZ_ADI_VARSAYILAN);
  assert.equal(CIHAZ_ADI_VARSAYILAN, 'Ev Paneli');
});

test('kayıt gövdesi: itme kanalı açık, şifreleme kapalı, sensör/konum/cihaz kimliği alanı yok', () => {
  const g = kayitGovdesi({ cihazAdi: 'Salon PC', kimlik: KIMLIK });
  assert.deepEqual(g, {
    app_id: 'tr.test.evpaneli',
    app_name: 'Ev Paneli',
    app_version: '1.4.0',
    device_name: 'Salon PC',
    manufacturer: 'Ev Paneli',
    model: 'Windows',
    os_name: 'Windows',
    os_version: '10.0.26300',
    supports_encryption: false,
    app_data: { push_websocket_channel: true },
  });
  assert.ok(!('device_id' in g), 'cihaz kimliği gönderilmez');
  assert.ok(!('app_data' in g && 'push_url' in g.app_data) && !('push_token' in g.app_data), 'dış itme servisi yok');
  const bos = kayitGovdesi({ kimlik: {} });
  assert.equal(bos.device_name, CIHAZ_ADI_VARSAYILAN);
  assert.equal(bos.app_id, 'ev-paneli');
  assert.equal(bos.os_version, 'Windows');
  assert.equal(kayitGovdesi({ cihazAdi: 'x', kimlik: { uygulamaKimligi: 'a'.repeat(500) } }).app_id.length, 100);
});

test('eylem gövdesi: yalnız fire_event/mobile_app_notification_action; geçersiz eylem null', () => {
  assert.deepEqual(eylemGovdesi('TAMAM', 'camasir'), { type: 'fire_event', data: { event_type: OLAY_TURU, event_data: { action: 'TAMAM', tag: 'camasir' } } });
  assert.deepEqual(eylemGovdesi('TAMAM', null), { type: 'fire_event', data: { event_type: OLAY_TURU, event_data: { action: 'TAMAM' } } });
  assert.deepEqual(eylemGovdesi('TAMAM', 'door'), { type: 'fire_event', data: { event_type: OLAY_TURU, event_data: { action: 'TAMAM' } } }, 'güvensiz etiket atılır');
  for (const kotu of ['', 'KAPI', 'a b', 'URI', null, 5, 'x'.repeat(65)]) assert.equal(eylemGovdesi(kotu, null), null, String(kotu));
  assert.equal(OLAY_TURU, 'mobile_app_notification_action');
});

test('webhook gövdesi doğrulaması: yalnız eylem olayı; sensör/konum/çağrı türleri ve fazladan alanlar reddedilir', () => {
  assert.equal(webhookGovdesiGecerliMi(eylemGovdesi('TAMAM', 'a')), true);
  assert.equal(webhookGovdesiGecerliMi(eylemGovdesi('TAMAM', null)), true);
  const kotuler = [
    { type: 'register_sensor', data: {} },
    { type: 'update_sensor_states', data: [] },
    { type: 'update_location', data: { gps: [0, 0] } },
    { type: 'call_service', data: { domain: 'light', service: 'turn_on' } },
    { type: 'fire_event', data: { event_type: 'zha_event', event_data: { action: 'TAMAM' } } },
    { type: 'fire_event', data: { event_type: OLAY_TURU, event_data: { action: 'TAMAM', ekstra: 1 } } },
    { type: 'fire_event', data: { event_type: OLAY_TURU, event_data: { action: 'TAMAM' }, ekstra: 1 } },
    { type: 'fire_event', data: { event_type: OLAY_TURU, event_data: { action: 'KAPI' } } },
    { type: 'fire_event', data: { event_type: OLAY_TURU, event_data: { action: 'TAMAM', tag: 'a b' } } },
    { type: 'fire_event', data: { event_type: OLAY_TURU, event_data: { action: 'TAMAM', tag: 5 } } },
    { type: 'fire_event', data: { event_type: OLAY_TURU, event_data: [] } },
    { type: 'fire_event', data: [] },
    { type: 'fire_event', data: null },
    { type: 'fire_event' },
    { type: 'fire_event', data: { event_type: OLAY_TURU, event_data: { action: 'TAMAM' } }, ekstra: 1 },
    [],
    null,
    'x',
    5,
  ];
  for (const kotu of kotuler) assert.equal(webhookGovdesiGecerliMi(kotu), false, JSON.stringify(kotu));
});

// --- kayıt ------------------------------------------------------------------------------

test('kaydol: tek korumalı POST (yüksek öncelik), webhook kimliği depoya yazılır, sonuçta/durumda görünmez', async () => {
  const o = kur();
  const sonuc = await o.mobil.kaydol();
  assert.deepEqual(sonuc, { ok: true });
  assert.equal(o.kayit.istekler.length, 1);
  assert.equal(o.kayit.istekler[0].yol, KAYIT_YOLU);
  assert.equal(o.kayit.istekler[0].yol, '/api/mobile_app/registrations');
  assert.equal(o.kayit.istekler[0].secenek.yontem, 'POST');
  assert.equal(o.kayit.istekler[0].secenek.oncelik, 'yuksek');
  assert.equal(o.kayit.istekler[0].secenek.govde.device_name, 'Salon PC');
  assert.equal(o.kayit.istekler[0].secenek.govde.app_data.push_websocket_channel, true);
  assert.equal(o.depo.deger(), WEBHOOK);
  assert.ok(!JSON.stringify(sonuc).includes(WEBHOOK));
  assert.ok(!JSON.stringify(o.mobil.durum()).includes(WEBHOOK), 'durum sır taşımaz');
  assert.ok(o.kayit.gunlukler.every((m) => !m.includes(WEBHOOK)));
  assert.ok(o.kayit.degisimler >= 2, 'başlangıç ve bitişte durum yayını');
});

test('kaydol: kimlik işlev olarak da verilebilir ve kayıt anında okunur', async () => {
  const kayit = { istekler: [] };
  const mobil = mobilKayitOlustur({
    haIstek: async (yol, secenek) => {
      kayit.istekler.push({ yol, secenek });
      return { webhook_id: WEBHOOK };
    },
    webhookGonder: async () => ({ durum: 200 }),
    depo: sahteDepo(),
    ws: sahteWs(),
    etkinMi: () => true,
    cihazAdiAl: () => '',
    kimlik: () => ({ ...KIMLIK, surum: '9.9.9' }),
    goster() {},
    temizle() {},
  });
  await mobil.kaydol();
  assert.equal(kayit.istekler[0].secenek.govde.app_version, '9.9.9');
  assert.equal(kayit.istekler[0].secenek.govde.device_name, CIHAZ_ADI_VARSAYILAN);
});

test('kaydol: şifreleme (safeStorage) yoksa kayıt yapılmaz, HA\'ya hiçbir şey gitmez', async () => {
  const o = kur({ depo: sahteDepo({ kullanilabilir: false }) });
  assert.deepEqual(await o.mobil.kaydol(), { ok: false, hata: 'sifreleme' });
  assert.equal(o.kayit.istekler.length, 0);
  assert.equal(o.depo.deger(), null);
});

test('kaydol: zaten kayıtlıysa ikinci cihaz oluşturulmaz', async () => {
  const o = kur({ depo: sahteDepo({ baslangic: WEBHOOK }) });
  assert.deepEqual(await o.mobil.kaydol(), { ok: true, zatenKayitli: true });
  assert.equal(o.kayit.istekler.length, 0);
});

test('kaydol: eşzamanlı ikinci çağrı "mesgul" döner, tek POST gider', async () => {
  let birak;
  const bekleyen = new Promise((coz) => {
    birak = coz;
  });
  const o = kur({
    haIstek: async () => {
      await bekleyen;
      return { webhook_id: WEBHOOK };
    },
  });
  const ilk = o.mobil.kaydol();
  await bekle();
  assert.equal(o.mobil.durum().kayitSuruyor, true);
  assert.deepEqual(await o.mobil.kaydol(), { ok: false, hata: 'mesgul' });
  birak();
  assert.deepEqual(await ilk, { ok: true });
  assert.equal(o.mobil.durum().kayitSuruyor, false);
});

test('kaydol: geçersiz webhook_id yanıtı kaydedilmez ("yanit", HA\'da cihaz oluşmuş olabilir)', async () => {
  for (const yanit of [{}, { webhook_id: 5 }, { webhook_id: 'kisa' }, { webhook_id: '../etc/passwd_______' }, null, 'metin', []]) {
    const o = kur({ haIstek: async () => yanit });
    assert.deepEqual(await o.mobil.kaydol(), { ok: false, hata: 'yanit', haDaOlustu: true }, JSON.stringify(yanit));
    assert.equal(o.depo.deger(), null);
  }
});

test('kaydol: depo yazamazsa "yazilamadi" (HA\'da cihaz oluşmuş olabilir); kayıt kalmaz', async () => {
  const o = kur({ depo: sahteDepo({ yazHatasi: true }) });
  assert.deepEqual(await o.mobil.kaydol(), { ok: false, hata: 'yazilamadi', haDaOlustu: true });
  assert.equal(o.depo.varMi(), false);
});

test('kaydol: HA hataları türüyle döner; yeniden DENENMEZ; kayıt oluşmaz', async () => {
  for (const [tur, kod] of [['yetki', 401], ['bulunamadi', 404], ['sunucu', 500], ['baglanti', 0], ['gecikti', 0], ['belirsiz', 0], ['reddedildi', 0]]) {
    let cagri = 0;
    const o = kur({
      haIstek: async () => {
        cagri += 1;
        throw Object.assign(new Error(tur), { tur, durumKodu: kod });
      },
    });
    const sonuc = await o.mobil.kaydol();
    assert.equal(sonuc.ok, false);
    assert.equal(sonuc.hata, tur);
    if (kod > 0) assert.equal(sonuc.durumKodu, kod);
    else assert.equal('durumKodu' in sonuc, false);
    assert.equal(cagri, 1, 'tek deneme');
    assert.equal(o.depo.varMi(), false);
  }
  const o = kur({
    haIstek: async () => {
      throw new Error('?');
    },
  });
  assert.deepEqual(await o.mobil.kaydol(), { ok: false, hata: 'bilinmiyor' });
});

// --- itme kanalı ---------------------------------------------------------------------------

test('baslat: kayıtlı ve ayar açıksa tek abonelik (webhook kimliğiyle, support_confirm kapalı); ikinci çağrı yenisini açmaz', async () => {
  const o = kur({ depo: sahteDepo({ baslangic: WEBHOOK }) });
  assert.equal(await o.mobil.baslat(), true);
  assert.equal(await o.mobil.baslat(), true);
  assert.equal(o.ws.abonelikler.length, 1);
  assert.deepEqual(o.ws.abonelikler[0].ileti, { type: KANAL_KOMUTU, webhook_id: WEBHOOK, support_confirm: false });
  assert.equal(KANAL_KOMUTU, 'mobile_app/push_notification_channel');
});

test('baslat: eşzamanlı iki çağrı da tek abonelik açar', async () => {
  const o = kur({ depo: sahteDepo({ baslangic: WEBHOOK }) });
  await Promise.all([o.mobil.baslat(), o.mobil.baslat()]);
  assert.equal(o.ws.aktifler().length, 1);
});

test('baslat: ayar kapalıysa ya da kayıt yoksa kanal açılmaz', async () => {
  const kapali = kur({ depo: sahteDepo({ baslangic: WEBHOOK }), etkin: false });
  assert.equal(await kapali.mobil.baslat(), false);
  assert.equal(kapali.ws.abonelikler.length, 0);
  const kayitsiz = kur();
  assert.equal(await kayitsiz.mobil.baslat(), false);
  assert.equal(kayitsiz.ws.abonelikler.length, 0);
});

test('baslat: depo okunamıyor ya da içerik bozuksa kanal açılmaz (günlüğe sır girmez)', async () => {
  const okunamaz = kur({ depo: sahteDepo({ baslangic: WEBHOOK, okumaHatasi: true }) });
  assert.equal(await okunamaz.mobil.baslat(), false);
  const bozuk = kur({ depo: sahteDepo({ baslangic: 'kisa' }) });
  assert.equal(await bozuk.mobil.baslat(), false);
  assert.equal(okunamaz.ws.abonelikler.length + bozuk.ws.abonelikler.length, 0);
  assert.ok(bozuk.kayit.gunlukler.every((m) => !m.includes('kisa')));
});

test('baslat: okuma sürerken ayar kapanırsa abonelik açılmaz', async () => {
  const o = kur({ depo: sahteDepo({ baslangic: WEBHOOK }) });
  const soz = o.mobil.baslat();
  o.durum.etkin = false;
  assert.equal(await soz, false);
  assert.equal(o.ws.abonelikler.length, 0);
});

test('durdur: aboneliği bırakır; sonra yeniden başlatılabilir', async () => {
  const o = kur({ depo: sahteDepo({ baslangic: WEBHOOK }) });
  await o.mobil.baslat();
  o.mobil.durdur();
  assert.equal(o.ws.aktifler().length, 0);
  o.mobil.durdur(); // ikinci kez zararsız
  assert.equal(await o.mobil.baslat(), true);
  assert.equal(o.ws.aktifler().length, 1);
});

test('durum().kanal: kayitsiz, kapali, bekliyor (WS yok), dinliyor (WS canlı)', async () => {
  const o = kur();
  assert.equal(o.mobil.durum().kanal, 'kayitsiz');
  assert.equal(o.mobil.durum().kayitli, false);
  await o.mobil.kaydol();
  assert.equal(o.mobil.durum().kayitli, true);
  assert.equal(o.mobil.durum().kanal, 'kapali', 'kayıtlı ama kanal henüz açık değil');
  await o.mobil.baslat();
  assert.equal(o.mobil.durum().kanal, 'dinliyor');
  o.ws.canliAyarla(false);
  assert.equal(o.mobil.durum().kanal, 'bekliyor');
  o.mobil.durdur();
  assert.equal(o.mobil.durum().kanal, 'kapali');
  const d = o.mobil.durum();
  assert.deepEqual(Object.keys(d).sort(), ['dusenBildirim', 'etkin', 'kanal', 'kayitSuruyor', 'kayitli', 'sonBildirim']);
  assert.equal(d.etkin, true);
});

// --- gelen bildirimler ----------------------------------------------------------------------

test('gelen bildirim çözülüp gösterilir: başlık, ileti, etiket ve yalnız güvenli düğmeler; eylem kimliği kaynağa taşınır (rendera değil)', async () => {
  const o = kur({ depo: sahteDepo({ baslangic: WEBHOOK }) });
  await o.mobil.baslat();
  o.ws.abonelikler[0].dinleyici({
    olay: olay('Çamaşır bitti', { title: 'Makine', data: { tag: 'camasir', actions: [{ action: 'TAMAM', title: 'Tamam' }, { action: 'KAPIYI_AC', title: 'Aç' }, { action: 'URL', title: 'Git', uri: 'https://ornek.invalid' }] } }),
  });
  assert.deepEqual(o.kayit.gosterilen, [{ baslik: 'Makine', mesaj: 'Çamaşır bitti', etiket: 'camasir', dugmeler: [{ eylem: 'TAMAM', baslik: 'Tamam' }] }]);
  const d = o.mobil.durum();
  assert.equal(d.sonBildirim, o.durum.an);
});

test('Kapı Kuralı: yasak sözcüklü bildirim hiç gösterilmez; durum "son bildirim" değişmez', async () => {
  const o = kur({ depo: sahteDepo({ baslangic: WEBHOOK }) });
  await o.mobil.baslat();
  for (const ileti of ['Ön kapı açık', 'Garage door open', 'La puerta está abierta', 'Alarm!']) o.ws.abonelikler[0].dinleyici({ olay: olay(ileti) });
  assert.equal(o.kayit.gosterilen.length, 0);
  assert.equal(o.mobil.durum().sonBildirim, null);
});

test('uzaktan komutlar yok sayılır; clear_notification güvenli etiketle kartı kapatır', async () => {
  const o = kur({ depo: sahteDepo({ baslangic: WEBHOOK }) });
  await o.mobil.baslat();
  const dinle = o.ws.abonelikler[0].dinleyici;
  dinle({ olay: olay('request_location_update') });
  dinle({ olay: olay('command_screen_on') });
  dinle({ olay: olay('remove_channel') });
  dinle({ olay: olay('clear_notification') });
  assert.equal(o.kayit.gosterilen.length, 0);
  assert.equal(o.kayit.temizlenen.length, 0);
  dinle({ olay: olay('clear_notification', { data: { tag: 'camasir' } }) });
  assert.deepEqual(o.kayit.temizlenen, ['camasir']);
  assert.equal(o.kayit.webhooklar.length, 0, 'komutlara yanıt (konum vb.) gönderilmez');
  assert.equal(o.kayit.istekler.length, 0);
});

test('bozuk olay yükleri sessizce atlanır', async () => {
  const o = kur({ depo: sahteDepo({ baslangic: WEBHOOK }) });
  await o.mobil.baslat();
  const dinle = o.ws.abonelikler[0].dinleyici;
  for (const yuk of [null, undefined, 'x', 5, [], {}, { olay: null }, { olay: 'x' }, { olay: [] }, { hata: 5 }, { olay: { message: 5 } }]) dinle(yuk);
  assert.equal(o.kayit.gosterilen.length, 0);
  assert.equal(o.mobil.durum().kanal, 'dinliyor');
});

test('gösterme işlevi hata fırlatırsa kanal ayakta kalır (sabit günlük metni, ileti içeriği yok)', async () => {
  const o = kur({ depo: sahteDepo({ baslangic: WEBHOOK }) });
  const ws = o.ws;
  const mobil = mobilKayitOlustur({
    haIstek: async () => ({}),
    webhookGonder: async () => ({}),
    depo: sahteDepo({ baslangic: WEBHOOK }),
    ws,
    etkinMi: () => true,
    cihazAdiAl: () => '',
    kimlik: KIMLIK,
    goster: () => {
      throw new Error('GIZLI_ICERIK');
    },
    temizle() {},
    gunluk: (m) => o.kayit.gunlukler.push(m),
  });
  await mobil.baslat();
  ws.abonelikler[0].dinleyici({ olay: olay('Merhaba dünya') });
  assert.deepEqual(o.kayit.gunlukler, ['Mobil bildirim gösterilemedi.']);
  assert.equal(mobil.durum().kanal, 'dinliyor');
});

test('hız sınırı: dakikada en çok 12 bildirim gösterilir, fazlası düşer ve sayılır; pencere kayınca yeniden açılır', async () => {
  const o = kur({ depo: sahteDepo({ baslangic: WEBHOOK }) });
  await o.mobil.baslat();
  const dinle = o.ws.abonelikler[0].dinleyici;
  for (let i = 0; i < EN_COK_GELEN + 5; i += 1) dinle({ olay: olay(`ileti ${i}`) });
  assert.equal(o.kayit.gosterilen.length, EN_COK_GELEN);
  assert.equal(o.mobil.durum().dusenBildirim, 5);
  o.durum.an += 60_001;
  dinle({ olay: olay('yeniden') });
  assert.equal(o.kayit.gosterilen.length, EN_COK_GELEN + 1);
  assert.equal(EN_COK_GELEN, 12);
});

// --- kanal hataları --------------------------------------------------------------------------

test('kanal hatası not_found: HA kaydı silmiş; yerel kayıt temizlenir, kanal kapanır, ayarlara "kayit-yok" bildirilir', async () => {
  const o = kur({ depo: sahteDepo({ baslangic: WEBHOOK }) });
  await o.mobil.baslat();
  o.ws.abonelikler[0].dinleyici({ hata: 'not_found' });
  await bekle();
  assert.equal(o.depo.varMi(), false);
  assert.equal(o.ws.aktifler().length, 0);
  assert.deepEqual(o.kayit.uyarilar, ['kayit-yok']);
  const d = o.mobil.durum();
  assert.equal(d.kanal, 'kayit-yok');
  assert.equal(d.kayitli, false);
  // yeniden kaydolunabilir; durum temizlenir
  assert.deepEqual(await o.mobil.kaydol(), { ok: true });
  assert.equal(o.mobil.durum().kanal, 'kapali');
});

test('kanal hatası unauthorized / unknown_command: kanal kapanır, kayıt SİLİNMEZ, uyarı verilir', async () => {
  for (const [kod, beklenen] of [['unauthorized', 'yetkisiz'], ['unknown_command', 'destek-yok']]) {
    const o = kur({ depo: sahteDepo({ baslangic: WEBHOOK }) });
    await o.mobil.baslat();
    o.ws.abonelikler[0].dinleyici({ hata: kod });
    await bekle();
    assert.equal(o.depo.varMi(), true, `${kod}: kayıt korunur`);
    assert.equal(o.ws.aktifler().length, 0);
    assert.deepEqual(o.kayit.uyarilar, [beklenen]);
    assert.equal(o.mobil.durum().kanal, beklenen);
  }
});

test('bilinmeyen kanal hataları kanalı kapatmaz', async () => {
  const o = kur({ depo: sahteDepo({ baslangic: WEBHOOK }) });
  await o.mobil.baslat();
  o.ws.abonelikler[0].dinleyici({ hata: 'baska_kod' });
  await bekle();
  assert.equal(o.ws.aktifler().length, 1);
  assert.deepEqual(o.kayit.uyarilar, []);
});

test('uyarı geri çağrısı hata fırlatsa da kayıt akışı bozulmaz', async () => {
  const ws = sahteWs();
  const depo = sahteDepo({ baslangic: WEBHOOK });
  const mobil = mobilKayitOlustur({
    haIstek: async () => ({}),
    webhookGonder: async () => ({}),
    depo,
    ws,
    etkinMi: () => true,
    cihazAdiAl: () => '',
    kimlik: KIMLIK,
    goster() {},
    temizle() {},
    uyari: () => {
      throw new Error('x');
    },
    durumDegisti: () => {
      throw new Error('y');
    },
  });
  await mobil.baslat();
  ws.abonelikler[0].dinleyici({ hata: 'not_found' });
  await bekle();
  assert.equal(depo.varMi(), false);
  assert.equal(mobil.durum().kanal, 'kayit-yok');
});

// --- kaydı sil -----------------------------------------------------------------------------------

test('kaydiSil: yerel kayıt silinir, kanal kapanır; HA\'ya hiçbir istek gitmez', async () => {
  const o = kur({ depo: sahteDepo({ baslangic: WEBHOOK }) });
  await o.mobil.baslat();
  const sonuc = await o.mobil.kaydiSil();
  assert.deepEqual(sonuc, { ok: true, silindi: true });
  assert.equal(o.depo.varMi(), false);
  assert.equal(o.ws.aktifler().length, 0);
  assert.equal(o.mobil.durum().kanal, 'kayitsiz');
  assert.equal(o.kayit.istekler.length, 0);
  assert.equal(o.kayit.webhooklar.length, 0);
  // kayıt yokken de zararsız
  assert.deepEqual(await o.mobil.kaydiSil(), { ok: true, silindi: false });
});

test('kaydiSil: depo silemezse "silinemedi"; kanal yine de kapanmıştır', async () => {
  const depo = { ...sahteDepo({ baslangic: WEBHOOK }), sil: async () => { throw new Error('x'); } };
  const o = kur({ depo });
  await o.mobil.baslat();
  assert.deepEqual(await o.mobil.kaydiSil(), { ok: false, hata: 'silinemedi' });
  assert.equal(o.ws.aktifler().length, 0);
});

test('kaydiSil: not_found sonrası kalan "kayit-yok" durumu temizlenir', async () => {
  const o = kur({ depo: sahteDepo({ baslangic: WEBHOOK }) });
  await o.mobil.baslat();
  o.ws.abonelikler[0].dinleyici({ hata: 'not_found' });
  await bekle();
  assert.equal(o.mobil.durum().kanal, 'kayit-yok');
  await o.mobil.kaydiSil();
  assert.equal(o.mobil.durum().kanal, 'kayitsiz');
});

// --- eylem gönderme -----------------------------------------------------------------------------

test('eylemGonder: webhook\'a TEK mobile_app_notification_action olayı gider (kimlik yalnız webhook işlevine)', async () => {
  const o = kur({ depo: sahteDepo({ baslangic: WEBHOOK }) });
  assert.deepEqual(await o.mobil.eylemGonder('TAMAM', 'camasir'), { ok: true });
  assert.equal(o.kayit.webhooklar.length, 1);
  assert.equal(o.kayit.webhooklar[0].kimlik, WEBHOOK);
  assert.deepEqual(o.kayit.webhooklar[0].govde, { type: 'fire_event', data: { event_type: 'mobile_app_notification_action', event_data: { action: 'TAMAM', tag: 'camasir' } } });
  assert.equal(o.kayit.istekler.length, 0);
});

test('eylemGonder: geçersiz / Kapı Kuralı\'na takılan eylem kimliği gitmez ("gecersiz")', async () => {
  const o = kur({ depo: sahteDepo({ baslangic: WEBHOOK }) });
  for (const eylem of ['', 'KAPIYI_AC', 'UNLOCK', 'a b', 'URI', null, undefined, 5, {}, 'x'.repeat(65), 'ALARM_KUR', 'SIREN']) {
    assert.deepEqual(await o.mobil.eylemGonder(eylem, null), { ok: false, hata: 'gecersiz' }, String(eylem));
  }
  assert.equal(o.kayit.webhooklar.length, 0);
});

test('eylemGonder: ayar kapalıysa "kapali", kayıt yoksa "kayitsiz"; hiçbir şey gitmez', async () => {
  const kapali = kur({ depo: sahteDepo({ baslangic: WEBHOOK }), etkin: false });
  assert.deepEqual(await kapali.mobil.eylemGonder('TAMAM', null), { ok: false, hata: 'kapali' });
  const kayitsiz = kur();
  assert.deepEqual(await kayitsiz.mobil.eylemGonder('TAMAM', null), { ok: false, hata: 'kayitsiz' });
  const bozuk = kur({ depo: sahteDepo({ baslangic: 'kisa' }) });
  assert.deepEqual(await bozuk.mobil.eylemGonder('TAMAM', null), { ok: false, hata: 'kayitsiz' });
  assert.equal(kapali.kayit.webhooklar.length + kayitsiz.kayit.webhooklar.length + bozuk.kayit.webhooklar.length, 0);
});

test('eylemGonder: 500 ms\'den sık ve dakikada 10\'dan fazla eylem gitmez ("cok-sik")', async () => {
  const o = kur({ depo: sahteDepo({ baslangic: WEBHOOK }) });
  assert.deepEqual(await o.mobil.eylemGonder('A1', null), { ok: true });
  o.durum.an += GIDEN_ARALIK_MS - 1;
  assert.deepEqual(await o.mobil.eylemGonder('A2', null), { ok: false, hata: 'cok-sik' });
  o.durum.an += 1;
  assert.deepEqual(await o.mobil.eylemGonder('A2', null), { ok: true });
  // 10'a tamamla
  for (let i = 0; i < EN_COK_GIDEN - 2; i += 1) {
    o.durum.an += GIDEN_ARALIK_MS;
    assert.deepEqual(await o.mobil.eylemGonder(`B${i}`, null), { ok: true });
  }
  assert.equal(o.kayit.webhooklar.length, EN_COK_GIDEN);
  o.durum.an += GIDEN_ARALIK_MS;
  assert.deepEqual(await o.mobil.eylemGonder('FAZLA', null), { ok: false, hata: 'cok-sik' });
  o.durum.an += 60_000;
  assert.deepEqual(await o.mobil.eylemGonder('YENI', null), { ok: true });
  assert.equal(o.kayit.webhooklar.length, EN_COK_GIDEN + 1);
});

test('eylemGonder: 410 (HA kaydı silmiş) yerel kaydı temizler, kanalı kapatır ve "kayit-yok" uyarır', async () => {
  const o = kur({
    depo: sahteDepo({ baslangic: WEBHOOK }),
    webhookGonder: async () => {
      throw Object.assign(new Error('bulunamadi'), { tur: 'bulunamadi', durumKodu: 410 });
    },
  });
  await o.mobil.baslat();
  assert.deepEqual(await o.mobil.eylemGonder('TAMAM', null), { ok: false, hata: 'kayit-yok' });
  assert.equal(o.depo.varMi(), false);
  assert.equal(o.ws.aktifler().length, 0);
  assert.deepEqual(o.kayit.uyarilar, ['kayit-yok']);
  assert.equal(o.mobil.durum().kanal, 'kayit-yok');
});

test('eylemGonder: diğer HA hataları türüyle döner, kayıt silinmez, yeniden denenmez', async () => {
  for (const tur of ['baglanti', 'gecikti', 'sunucu', 'reddedildi', 'belirsiz']) {
    let cagri = 0;
    const o = kur({
      depo: sahteDepo({ baslangic: WEBHOOK }),
      webhookGonder: async () => {
        cagri += 1;
        throw Object.assign(new Error(tur), { tur, durumKodu: 500 });
      },
    });
    assert.deepEqual(await o.mobil.eylemGonder('TAMAM', null), { ok: false, hata: tur });
    assert.equal(cagri, 1);
    assert.equal(o.depo.varMi(), true);
  }
  const o = kur({
    depo: sahteDepo({ baslangic: WEBHOOK }),
    webhookGonder: async () => {
      throw new Error('?');
    },
  });
  assert.deepEqual(await o.mobil.eylemGonder('TAMAM', null), { ok: false, hata: 'bilinmiyor' });
});

// --- sensör / konum gönderilmez (yapısal) --------------------------------------------------------

function jsDosyalari(klasor) {
  const sonuc = [];
  for (const ad of fs.readdirSync(klasor, { withFileTypes: true })) {
    const yol = path.join(klasor, ad.name);
    if (ad.isDirectory()) sonuc.push(...jsDosyalari(yol));
    else if (ad.name.endsWith('.js')) sonuc.push(yol);
  }
  return sonuc;
}

const yorumsuz = (kaynak) => kaynak.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');

test('hiçbir kaynak dosya sensör kaydı, durum güncellemesi ya da konum bildirimi göndermez (o-61: sensör YOK)', () => {
  const kok = path.join(__dirname, '..', 'src');
  const yasak = /register_sensor|update_sensor_states|update_location|enable_sensor|disable_sensor|get_zones|render_template|update_registration|'call_service'|"call_service"/;
  for (const dosya of jsDosyalari(kok)) {
    assert.doesNotMatch(yorumsuz(fs.readFileSync(dosya, 'utf8')), yasak, `${path.relative(kok, dosya)}: webhook sensör/konum türü`);
  }
});

test('webhook yalnız ha-istemcisi.js\'te çağrılır ve yalnız mobil-kayit.js tarafından kullanılır; kayıt POST\'u main.js\'te değil', () => {
  const kok = path.join(__dirname, '..', 'src');
  const webhookYolu = jsDosyalari(kok).filter((d) => /\/api\/webhook\//.test(yorumsuz(fs.readFileSync(d, 'utf8'))));
  assert.deepEqual(webhookYolu.map((d) => path.relative(kok, d).replace(/\\/g, '/')), ['ha-istemcisi.js']);
  const main = yorumsuz(fs.readFileSync(path.join(kok, 'main.js'), 'utf8'));
  assert.doesNotMatch(main, /mobile_app\/registrations/);
  assert.doesNotMatch(main, /yontem:\s*'POST'/);
  assert.match(main, /webhookGonder:\s*\(/);
});

test('saf modüller: yalnız node:/yerel require; ağ (fetch), electron ve dosya sistemi yok; günlüğe içerik girmez', () => {
  const lib = path.join(__dirname, '..', 'src', 'lib');
  for (const ad of ['mobil-kayit.js', 'itme-bildirimi.js', 'itme-kuyrugu.js']) {
    const kaynak = yorumsuz(fs.readFileSync(path.join(lib, ad), 'utf8'));
    for (const [, istek] of kaynak.matchAll(/require\('([^']+)'\)/g)) assert.match(istek, /^(node:|\.\/)/, `${ad}: ${istek}`);
    assert.doesNotMatch(kaynak, /\bfetch\(|electron|WebSocket|XMLHttpRequest|child_process|console\./, ad);
  }
  // mobil-kayit.js günlüğe yalnız sabit metin yazar
  const kayit = fs.readFileSync(path.join(lib, 'mobil-kayit.js'), 'utf8');
  for (const [, arguman] of kayit.matchAll(/gunluk\(([^)]*)\)/g)) assert.match(arguman.trim(), /^'[^'$]*'$/, `gunluk(${arguman})`);
});
