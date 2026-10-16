'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TARAMA_ARALIGI_MS,
  ILK_TARAMA_MS,
  AYAR_TARAMA_MS,
  TARAMA_YENIDEN_MS,
  YANSITMA_SINIRI,
  YANSITMA_PENCERESI_MS,
  bildirimAkisiOlustur,
  opakAnahtar,
} = require('../src/lib/bildirim-akisi');
const { kapatilanAnahtariGecerliMi } = require('../src/lib/bildirim-merkezi');

function sahteZaman() {
  let sonId = 0;
  let simdi = 10_000_000;
  const bekleyenler = new Map();
  return {
    setTimeout(fn, ms) {
      sonId += 1;
      bekleyenler.set(sonId, { fn, bitis: simdi + ms });
      return sonId;
    },
    clearTimeout(id) {
      bekleyenler.delete(id);
    },
    simdi: () => simdi,
    async ilerle(ms) {
      simdi += ms;
      for (const [id, v] of [...bekleyenler].sort((a, b) => a[1].bitis - b[1].bitis)) {
        if (v.bitis <= simdi && bekleyenler.has(id)) {
          bekleyenler.delete(id);
          await v.fn();
        }
      }
    },
    bekleyen: () => bekleyenler.size,
  };
}

const pil = (kimlik, state, ek = {}) => ({ entity_id: kimlik, state, attributes: { device_class: 'battery', unit_of_measurement: '%', friendly_name: 'Pil', ...ek } });
const guncelleme = (kimlik, state, ek = {}) => ({ entity_id: kimlik, state, attributes: { friendly_name: 'Core', latest_version: '2026.10.1', ...ek } });
const haB = (id, metin, ek = {}) => ({ id, baslik: null, metin, zaman: '2026-10-16T09:00:00+00:00', ...ek });

function kur(ayarlar = {}, secenek = {}) {
  const zaman = sahteZaman();
  const durumlar = new Map();
  const gosterilen = [];
  const gunluk = [];
  const istekler = [];
  const degisimler = { sayi: 0 };
  const kapatilan = {
    kume: new Set(),
    var(a) {
      return this.kume.has(a);
    },
    ekle(a) {
      if (!kapatilanAnahtariGecerliMi(a)) return false;
      this.kume.add(a);
      return true;
    },
    sil(a) {
      this.kume.delete(a);
    },
    anahtarlar() {
      return [...this.kume];
    },
    yukle() {
      this.yuklendi = true;
    },
    bosalt() {
      this.bosaldi = true;
    },
  };
  const abonelikler = { dinleyici: null, birakildi: 0, sayi: 0 };
  const okuma = {
    bildirimAboneOl(d) {
      abonelikler.sayi += 1;
      abonelikler.dinleyici = d;
      return () => {
        abonelikler.birakildi += 1;
        abonelikler.dinleyici = null;
      };
    },
  };
  const durum = { ayar: { bildirimKalici: true, bildirimPil: true, bildirimGuncelleme: false, bildirimPilEsigi: 20, bildirimMasaustu: true, uyariKurallari: [], ...ayarlar }, taramaYaniti: [], taramaHatasi: false };
  const haKapatCagrilari = [];
  const akis = bildirimAkisiOlustur({
    okumaAl: () => (secenek.okumaYok ? null : okuma),
    haIstek: async (yol) => {
      istekler.push(yol);
      if (durum.taramaHatasi) throw new Error('ag');
      return durum.taramaYaniti;
    },
    depo: { al: (k) => durumlar.get(k) },
    ayarAl: () => durum.ayar,
    goster: (g) => gosterilen.push(g),
    degisti: () => {
      degisimler.sayi += 1;
    },
    haKapat: async (id) => {
      haKapatCagrilari.push(id);
      return secenek.haKapatSonuc ?? { ok: true };
    },
    kapatilan,
    simdi: zaman.simdi,
    zaman,
    gunluk: (m) => gunluk.push(m),
  });
  const durumYaz = (kimlik, state, ek = {}) => {
    durumlar.set(kimlik, { entity_id: kimlik, state, attributes: { friendly_name: 'Salon', ...ek } });
    akis.depoDegisti([kimlik]);
  };
  return { akis, zaman, durumlar, gosterilen, gunluk, istekler, degisimler, kapatilan, abonelikler, durum, haKapatCagrilari, durumYaz };
}

/** Panelde görünen ilk öğenin (opak) anahtarı. */
const ilkAnahtar = (akis) => akis.model().ogeler[0].anahtar;

const esikKurali = (ek = {}) => ({ id: 'u1', varlik: 'sensor.sicaklik', kosul: { tur: 'esik', yon: 'ustunde', deger: 30 }, bekleme: 0, ...ek });

// --- başlangıç ------------------------------------------------------------------------------------------------------------

test('akış: baslat kapatılanları yükler, HA bildirimlerine abone olur ve ilk taramayı planlar', () => {
  const k = kur();
  k.akis.baslat();
  assert.equal(k.kapatilan.yuklendi, true);
  assert.equal(k.abonelikler.sayi, 1);
  assert.equal(k.akis.durum().tarama, true);
  assert.equal(k.istekler.length, 0, 'tarama gecikmeli başlar');
});

test('akış: bildirimKalici kapalıyken abonelik kurulmaz', () => {
  const k = kur({ bildirimKalici: false });
  k.akis.baslat();
  assert.equal(k.abonelikler.sayi, 0);
});

test('akış: ha-okuma yoksa (bağlanmadıysa) çökmez', () => {
  const k = kur({}, { okumaYok: true });
  assert.doesNotThrow(() => k.akis.baslat());
  assert.equal(k.akis.durum().abone, false);
});

test('akış: pil ve güncelleme kapalıyken hiç tarama isteği yapılmaz', async () => {
  const k = kur({ bildirimPil: false, bildirimGuncelleme: false });
  k.akis.baslat();
  assert.equal(k.akis.durum().tarama, false);
  await k.zaman.ilerle(60 * 60 * 1000);
  assert.equal(k.istekler.length, 0);
});

// --- HA bildirimleri ve yansıtma -------------------------------------------------------------------------------------------

test('akış: ilk HA listesi masaüstüne yansımaz, sonradan gelen yansır', () => {
  const k = kur();
  k.akis.baslat();
  k.abonelikler.dinleyici([haB('a1', 'Eski')], { gizlenen: 0 });
  assert.equal(k.gosterilen.length, 0);
  k.abonelikler.dinleyici([haB('a1', 'Eski'), haB('b2', 'Yeni', { baslik: 'Yedek' })], { gizlenen: 0 });
  assert.equal(k.gosterilen.length, 1);
  assert.equal(k.gosterilen[0].kaynak, 'ha');
  assert.equal(k.gosterilen[0].baslik, 'Yedek');
  assert.equal(k.gosterilen[0].metin, 'Yeni');
  assert.equal(k.gosterilen[0].windows, false);
  assert.equal(k.akis.model().sayi, 2);
});

test('akış: bildirimMasaustu kapalıyken panelde görünür ama masaüstüne yansımaz', () => {
  const k = kur({ bildirimMasaustu: false });
  k.akis.baslat();
  k.abonelikler.dinleyici([], {});
  k.abonelikler.dinleyici([haB('b2', 'Yeni')], {});
  assert.equal(k.gosterilen.length, 0);
  assert.equal(k.akis.model().sayi, 1);
});

test('akış: yansıtma dakikada YANSITMA_SINIRI ile sınırlıdır, fazlası tek özet olur', async () => {
  const k = kur();
  k.akis.baslat();
  k.abonelikler.dinleyici([], {});
  const liste = [];
  for (let i = 0; i < 8; i += 1) {
    liste.push(haB(`n${i}`, `Bildirim ${i}`));
    k.abonelikler.dinleyici([...liste], {});
  }
  assert.equal(k.gosterilen.length, YANSITMA_SINIRI);
  assert.equal(k.akis.durum().biriken, 8 - YANSITMA_SINIRI);
  await k.zaman.ilerle(YANSITMA_PENCERESI_MS + 1);
  assert.equal(k.gosterilen.length, YANSITMA_SINIRI + 1, 'tek özet bildirimi');
  const ozet = k.gosterilen.at(-1);
  assert.ok(ozet.metin.includes(String(8 - YANSITMA_SINIRI)), ozet.metin);
  assert.equal(k.akis.durum().biriken, 0);
});

test('akış (kapı kuralı): kapı sözcüklü HA bildirimi hiçbir yüzeyde gösterilmez', () => {
  const k = kur();
  k.akis.baslat();
  k.abonelikler.dinleyici([], {});
  k.abonelikler.dinleyici([haB('g1', 'Garaj [kapısı](x) açık')], { gizlenen: 0 });
  assert.equal(k.gosterilen.length, 0);
  assert.equal(k.akis.model().sayi, 0);
  assert.equal(k.akis.model().gizlenen, 1);
});

test('akış: panel değişimi `degisti` ile bildirilir', () => {
  const k = kur();
  k.akis.baslat();
  const onceki = k.degisimler.sayi;
  k.abonelikler.dinleyici([haB('a1', 'Bir')], {});
  assert.ok(k.degisimler.sayi > onceki);
});

// --- kapatma ------------------------------------------------------------------------------------------------------------------

test('akış: HA bildirimi kapatma haKapat\'ı çağırır ve başarıda listeden çıkar', async () => {
  const k = kur();
  k.akis.baslat();
  k.abonelikler.dinleyici([haB('a1', 'Bir')], {});
  assert.equal(k.akis.bildirimKayitliMi('a1'), true);
  const sonuc = await k.akis.kapat(ilkAnahtar(k.akis));
  assert.deepEqual(sonuc, { ok: true });
  assert.deepEqual(k.haKapatCagrilari, ['a1']);
  assert.equal(k.akis.model().sayi, 0);
  assert.equal(k.akis.bildirimKayitliMi('a1'), false);
});

test('akış: HA kapatma başarısızsa öğe listede kalır', async () => {
  const k = kur({}, { haKapatSonuc: { ok: false, tur: 'ha-hatasi' } });
  k.akis.baslat();
  k.abonelikler.dinleyici([haB('a1', 'Bir')], {});
  const sonuc = await k.akis.kapat(ilkAnahtar(k.akis));
  assert.equal(sonuc.ok, false);
  assert.equal(sonuc.tur, 'ha-hatasi');
  assert.equal(k.akis.model().sayi, 1);
});

test('akış: haKapat fırlatırsa kapat çökmez', async () => {
  const zaman = sahteZaman();
  let dinleyici = null;
  const akis = bildirimAkisiOlustur({
    okumaAl: () => ({ bildirimAboneOl: (d) => ((dinleyici = d), () => {}) }),
    haIstek: async () => [],
    depo: { al: () => undefined },
    ayarAl: () => ({}),
    goster: () => {},
    haKapat: async () => {
      throw new Error('x');
    },
    kapatilan: { var: () => false, ekle: () => true, sil: () => {}, anahtarlar: () => [] },
    zaman,
    simdi: zaman.simdi,
  });
  akis.baslat();
  dinleyici([haB('a1', 'Bir')], {});
  const sonuc = await akis.kapat(ilkAnahtar(akis));
  assert.equal(sonuc.ok, false);
});

test('akış: bilinmeyen anahtar kapatılamaz ve haKapat çağrılmaz', async () => {
  const k = kur();
  k.akis.baslat();
  assert.deepEqual(await k.akis.kapat(opakAnahtar('ha:yok')), { ok: false, tur: 'yok' });
  assert.deepEqual(await k.akis.kapat('ha:yok'), { ok: false, tur: 'yok' }, 'ham anahtar kabul edilmez');
  assert.deepEqual(await k.akis.kapat(null), { ok: false, tur: 'yok' });
  assert.equal(k.haKapatCagrilari.length, 0);
});

test('akış: gizli (süzgeçten geçmeyen) HA bildirimi kapatılamaz', async () => {
  const k = kur();
  k.akis.baslat();
  k.abonelikler.dinleyici([haB('g1', 'Garaj [kapısı](x) açık')], {});
  assert.equal(k.akis.bildirimKayitliMi('g1'), false);
  assert.deepEqual(await k.akis.kapat(opakAnahtar('ha:g1')), { ok: false, tur: 'yok' });
  assert.equal(k.haKapatCagrilari.length, 0);
});

test('akış: panele giden anahtarlar opaktır (HA bildirim kimliği ve varlık kimliği panele sızmaz); kapatma opak anahtarla yapılır', async () => {
  const k = kur();
  k.durum.taramaYaniti = [pil('sensor.a_pil', '10')];
  k.akis.baslat();
  k.abonelikler.dinleyici([haB('garage_door_left_open_alert', 'Bir şey oldu')], {});
  await k.zaman.ilerle(ILK_TARAMA_MS);
  const model = k.akis.model();
  assert.equal(model.sayi, 2);
  for (const oge of model.ogeler) {
    assert.match(oge.anahtar, /^k[0-9a-f]{16}$/);
    assert.doesNotMatch(JSON.stringify(oge), /garage|door|sensor\.a_pil/i, 'ham kimlik panele gitmez');
    assert.doesNotMatch(oge.anahtar, /[:._]/, 'anahtar ham kimlikten türemiş okunur bir parça taşımaz');
  }
  assert.deepEqual(Object.keys(model.ogeler[0]).sort(), ['anahtar', 'baslik', 'kaynak', 'metin', 'simge', 'zaman']);
  const ha = model.ogeler.find((o) => o.kaynak === 'ha');
  assert.deepEqual(await k.akis.kapat(ha.anahtar), { ok: true });
  assert.deepEqual(k.haKapatCagrilari, ['garage_door_left_open_alert']);
  assert.notEqual(opakAnahtar('ha:a'), opakAnahtar('ha:b'));
  assert.equal(opakAnahtar('ha:a'), opakAnahtar('ha:a'), 'kararlı');
});

test('akış: kapat çağrısına özel haKapat kurulumdakinin yerine kullanılır (yuzey:bildirim-kapat eylem katmanını böyle verir)', async () => {
  const k = kur();
  k.akis.baslat();
  k.abonelikler.dinleyici([haB('a1', 'Bir')], {});
  const ozel = [];
  const sonuc = await k.akis.kapat(ilkAnahtar(k.akis), async (id) => (ozel.push(id), { ok: true }));
  assert.deepEqual(sonuc, { ok: true });
  assert.deepEqual(ozel, ['a1']);
  assert.deepEqual(k.haKapatCagrilari, []);
});

// --- tarama ---------------------------------------------------------------------------------------------------------------------

test('akış: ilk tarama gecikmeli yapılır, sonra 10 dakikada bir tekrarlanır; yalnız GET /api/states', async () => {
  const k = kur();
  k.durum.taramaYaniti = [pil('sensor.a_pil', '10')];
  k.akis.baslat();
  await k.zaman.ilerle(ILK_TARAMA_MS - 1);
  assert.equal(k.istekler.length, 0);
  await k.zaman.ilerle(1);
  assert.deepEqual(k.istekler, ['/api/states']);
  assert.equal(k.akis.model().sayi, 1, 'düşük pil panelde');
  assert.equal(k.gosterilen.length, 0, 'ilk tarama sessiz');
  await k.zaman.ilerle(TARAMA_ARALIGI_MS);
  assert.equal(k.istekler.length, 2);
});

test('akış: taramada sonradan düşen pil masaüstüne yansır', async () => {
  const k = kur();
  k.durum.taramaYaniti = [pil('sensor.a_pil', '50')];
  k.akis.baslat();
  await k.zaman.ilerle(ILK_TARAMA_MS);
  k.durum.taramaYaniti = [pil('sensor.a_pil', '15')];
  await k.zaman.ilerle(TARAMA_ARALIGI_MS);
  assert.equal(k.gosterilen.length, 1);
  assert.equal(k.gosterilen[0].kaynak, 'pil');
});

test('akış: tarama hatasında kısa aralıkla yeniden dener, günlüğe bir kez sabit metin yazar', async () => {
  const k = kur();
  k.durum.taramaHatasi = true;
  k.akis.baslat();
  await k.zaman.ilerle(ILK_TARAMA_MS);
  assert.equal(k.istekler.length, 1);
  await k.zaman.ilerle(TARAMA_YENIDEN_MS);
  assert.equal(k.istekler.length, 2);
  assert.equal(k.gunluk.filter((m) => m.includes('taraması')).length, 1, 'her denemede günlük şişmez');
  assert.ok(k.gunluk.every((m) => !m.includes('/api')));
  k.durum.taramaHatasi = false;
  await k.zaman.ilerle(TARAMA_YENIDEN_MS);
  assert.equal(k.istekler.length, 3);
  await k.zaman.ilerle(TARAMA_ARALIGI_MS);
  assert.equal(k.istekler.length, 4, 'başarıdan sonra normal aralık');
});

test('akış: geçersiz tarama yanıtı (dizi değil) çökmez', async () => {
  const k = kur();
  k.durum.taramaYaniti = { hata: true };
  k.akis.baslat();
  await k.zaman.ilerle(ILK_TARAMA_MS);
  assert.equal(k.akis.model().sayi, 0);
});

test('akış: ayar sonradan açılınca çabuk taranır; ikisi de kapanınca tarama durur ve veri sıfırlanır', async () => {
  const k = kur({ bildirimPil: false });
  k.durum.taramaYaniti = [pil('sensor.a_pil', '10')];
  k.akis.baslat();
  k.durum.ayar = { ...k.durum.ayar, bildirimPil: true };
  k.akis.ayarDegisti();
  await k.zaman.ilerle(AYAR_TARAMA_MS);
  assert.equal(k.istekler.length, 1);
  assert.equal(k.gosterilen.length, 0, 'ayarla açılan kaynak sessiz başlar');
  assert.equal(k.akis.model().sayi, 1);
  k.durum.ayar = { ...k.durum.ayar, bildirimPil: false };
  k.akis.ayarDegisti();
  assert.equal(k.akis.durum().tarama, false);
  assert.equal(k.akis.model().sayi, 0);
  await k.zaman.ilerle(TARAMA_ARALIGI_MS * 3);
  assert.equal(k.istekler.length, 1);
});

test('akış: bildirimKalici kapatılınca abonelik bırakılır, açılınca yeniden kurulur ve mevcutlar sessizdir', () => {
  const k = kur();
  k.akis.baslat();
  k.abonelikler.dinleyici([haB('a1', 'Bir')], {});
  k.durum.ayar = { ...k.durum.ayar, bildirimKalici: false };
  k.akis.ayarDegisti();
  assert.equal(k.abonelikler.birakildi, 1);
  assert.equal(k.akis.model().sayi, 0);
  k.durum.ayar = { ...k.durum.ayar, bildirimKalici: true };
  k.akis.ayarDegisti();
  assert.equal(k.abonelikler.sayi, 2);
  k.abonelikler.dinleyici([haB('a1', 'Bir')], {});
  assert.equal(k.gosterilen.length, 0, 'yeniden abonelikte mevcut bildirim yansımaz');
});

// --- uyarı kuralları ---------------------------------------------------------------------------------------------------------------

test('akış: uyarı kuralı koşul sağlanınca köşe bildirimi ve panel şeridi üretir (o-37)', () => {
  const k = kur({ uyariKurallari: [esikKurali()] });
  k.akis.baslat();
  assert.deepEqual([...k.akis.izlenenKimlikler()], ['sensor.sicaklik']);
  k.durumYaz('sensor.sicaklik', '20');
  k.durumYaz('sensor.sicaklik', '35', { unit_of_measurement: '°C' });
  assert.equal(k.gosterilen.length, 1);
  assert.equal(k.gosterilen[0].kaynak, 'uyari');
  assert.equal(k.gosterilen[0].baslik, 'Uyarı');
  assert.ok(k.gosterilen[0].metin.includes('Salon'));
  assert.equal(k.gosterilen[0].windows, false);
  const model = k.akis.model();
  assert.equal(model.sayi, 1);
  assert.equal(model.ogeler[0].kaynak, 'uyari');
});

test('akış: sessiz saatte uyarı açılır pencere olmaz ama panel şeridine eklenir (o-39)', () => {
  const simdi = new Date(10_000_000); // sahteZaman'ın başlangıcı (değerlendirici yerel saati bundan türetir)
  const dakika = simdi.getHours() * 60 + simdi.getMinutes();
  const hhmm = (d) => `${String(Math.floor(((d % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String((((d % 1440) + 1440) % 1440) % 60).padStart(2, '0')}`;
  // Şimdiki saati çevreleyen 2 saatlik bir aralık; gece yarısını da aşabilir.
  const sessiz = { baslangic: hhmm(dakika - 60), bitis: hhmm(dakika + 60) };
  const k = kur({ uyariKurallari: [esikKurali({ sessizSaatler: sessiz })] });
  k.akis.baslat();
  k.durumYaz('sensor.sicaklik', '20');
  k.durumYaz('sensor.sicaklik', '35');
  assert.equal(k.gosterilen.length, 0);
  assert.equal(k.akis.model().sayi, 1);
});

test('akış: windows bayrağı gösterime taşınır', () => {
  const k = kur({ uyariKurallari: [esikKurali({ windows: true })] });
  k.akis.baslat();
  k.durumYaz('sensor.sicaklik', '20');
  k.durumYaz('sensor.sicaklik', '35');
  assert.equal(k.gosterilen[0].windows, true);
});

test('akış: kurallar ayardan değişince değerlendirici yeniden kurulur; kapalı kural izlenmez', () => {
  const k = kur({ uyariKurallari: [esikKurali()] });
  k.akis.baslat();
  k.durum.ayar = { ...k.durum.ayar, uyariKurallari: [esikKurali({ acik: false })] };
  k.akis.ayarDegisti();
  assert.equal(k.akis.izlenenKimlikler().size, 0);
  k.durumYaz('sensor.sicaklik', '20');
  k.durumYaz('sensor.sicaklik', '35');
  assert.equal(k.gosterilen.length, 0);
});

test('akış: bozuk kural ayarı sessizce atılır (kapı kuralı: kilit alanı kural olamaz)', () => {
  const k = kur({ uyariKurallari: [{ id: 'x1', varlik: 'lock.on_kapi', kosul: { tur: 'bilinmiyor' } }, 'bozuk', null] });
  k.akis.baslat();
  assert.equal(k.akis.izlenenKimlikler().size, 0);
  assert.equal(k.akis.durum().kural, 0);
});

test('akış: bağlantı değişince ısınma başlar, aradaki değişim uyarı üretmez', () => {
  const k = kur({ uyariKurallari: [esikKurali()] });
  k.akis.baslat();
  k.durumYaz('sensor.sicaklik', '20');
  k.akis.baglantiDegisti();
  k.durumYaz('sensor.sicaklik', '35');
  assert.equal(k.gosterilen.length, 0);
});

test('akış: kuralsız ortamda depoDegisti değerlendirici çalıştırmaz', () => {
  const k = kur();
  k.akis.baslat();
  assert.doesNotThrow(() => k.akis.depoDegisti(['light.salon']));
  assert.equal(k.akis.izlenenKimlikler().size, 0);
});

// --- genel ---------------------------------------------------------------------------------------------------------------------------

test('akış: goster fırlatırsa akış devam eder', () => {
  const zaman = sahteZaman();
  let dinleyici = null;
  const akis = bildirimAkisiOlustur({
    okumaAl: () => ({ bildirimAboneOl: (d) => ((dinleyici = d), () => {}) }),
    haIstek: async () => [],
    depo: { al: () => undefined },
    ayarAl: () => ({}),
    goster: () => {
      throw new Error('x');
    },
    haKapat: async () => ({ ok: true }),
    kapatilan: { var: () => false, ekle: () => true, sil: () => {}, anahtarlar: () => [] },
    zaman,
    simdi: zaman.simdi,
  });
  akis.baslat();
  dinleyici([], {});
  assert.doesNotThrow(() => dinleyici([haB('a1', 'Bir')], {}));
  assert.equal(akis.model().sayi, 1);
});

test('akış: ayarAl fırlatırsa varsayılanlarla çalışır', () => {
  const zaman = sahteZaman();
  const akis = bildirimAkisiOlustur({
    okumaAl: () => null,
    haIstek: async () => [],
    depo: { al: () => undefined },
    ayarAl: () => {
      throw new Error('x');
    },
    goster: () => {},
    haKapat: async () => ({ ok: true }),
    kapatilan: { var: () => false, ekle: () => true, sil: () => {}, anahtarlar: () => [] },
    zaman,
    simdi: zaman.simdi,
  });
  assert.doesNotThrow(() => akis.baslat());
  akis.durdur();
});

test('akış: durdur abonelik ve zamanlayıcıları temizler, kapatılan dosyasını boşaltır', () => {
  const k = kur({ uyariKurallari: [esikKurali({ sure: 60 })] });
  k.akis.baslat();
  k.durumYaz('sensor.sicaklik', '20');
  k.durumYaz('sensor.sicaklik', '35');
  k.akis.durdur();
  assert.equal(k.abonelikler.birakildi, 1);
  assert.equal(k.zaman.bekleyen(), 0);
  assert.equal(k.kapatilan.bosaldi, true);
  k.durumYaz('sensor.sicaklik', '20');
  assert.equal(k.gosterilen.length, 0);
});

test('akış: yerel kapatılan pil öğesi panelde görünmez', async () => {
  const k = kur();
  k.durum.taramaYaniti = [pil('sensor.a_pil', '10')];
  k.akis.baslat();
  await k.zaman.ilerle(ILK_TARAMA_MS);
  assert.deepEqual(await k.akis.kapat(ilkAnahtar(k.akis)), { ok: true });
  assert.equal(k.akis.model().sayi, 0);
  assert.equal(k.kapatilan.kume.has('pil:sensor.a_pil'), true);
});
