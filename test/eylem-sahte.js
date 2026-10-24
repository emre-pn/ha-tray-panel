'use strict';

/**
 * Eylem grubu testleri (o-12, o-14, o-15, o-17, o-18, o-46) için ortak SAHTELER: sanal saat, bellek içi dosya sistemi, sahte Home Assistant
 * (durum tutar, hizmet çağrılarının etkisini uygular ve her isteği kaydeder) ve gerçek eylem katmanını (src/eylem.js) bunlarla kuran fabrika.
 * Gerçek Home Assistant, ağ, Electron ya da pencere YOK.
 */

const { eylemKatmaniOlustur } = require('../src/eylem');
const { durumDeposuOlustur } = require('../src/lib/durum-deposu');
const { yuzeyModeliOlustur } = require('../src/lib/yuzey-modeli');

/** Bellek içi dosya sistemi (src/lib/*-gecmisi.js ve benzerlerinin fs bağımlılığı). */
function sahteFs(baslangic = {}) {
  const dosyalar = new Map(Object.entries(baslangic));
  const yazimlar = [];
  return {
    dosyalar,
    yazimlar,
    existsSync: (y) => dosyalar.has(y),
    readFileSync: (y) => {
      if (!dosyalar.has(y)) throw new Error('yok');
      return dosyalar.get(y);
    },
    mkdirSync: () => {},
    writeFileSync: (y, v) => {
      yazimlar.push(y);
      dosyalar.set(y, v);
    },
    renameSync: (a, b) => {
      dosyalar.set(b, dosyalar.get(a));
      dosyalar.delete(a);
    },
    unlinkSync: (y) => {
      dosyalar.delete(y);
    },
  };
}

/**
 * Sanal saat: simdi() ve zamanlayıcılar. ileri(ms) saati ilerletir ve vadesi gelen zamanlayıcıları sırayla çalıştırır;
 * uyku(ms) sistem uykusunu taklit eder (saat ilerler ama zamanlayıcılar çalışmaz; uyanınca vadesi geçmiş olurlar).
 */
function sahteSaat(baslangic = 1_700_000_000_000) {
  let simdi = baslangic;
  let sayac = 0;
  const zamanlayicilar = new Map();
  const saat = {
    simdi: () => simdi,
    setTimeout: (fn, ms) => {
      sayac += 1;
      zamanlayicilar.set(sayac, { fn, vakit: simdi + Math.max(0, ms) });
      return sayac;
    },
    clearTimeout: (id) => {
      zamanlayicilar.delete(id);
    },
    async ileri(ms) {
      const hedef = simdi + ms;
      for (;;) {
        const sirada = [...zamanlayicilar.entries()].filter(([, z]) => z.vakit <= hedef).sort((a, b) => a[1].vakit - b[1].vakit)[0];
        if (!sirada) break;
        zamanlayicilar.delete(sirada[0]);
        simdi = Math.max(simdi, sirada[1].vakit);
        await sirada[1].fn();
      }
      simdi = hedef;
    },
    uyku(ms) {
      simdi += ms;
    },
    /** Uyku sonrası: vadesi geçmiş zamanlayıcıları şimdi çalıştırır (gerçek zamanlayıcılar uyanınca böyle gecikmeli ateşlenir). */
    async uyanis() {
      const gecmis = [...zamanlayicilar.entries()].filter(([, z]) => z.vakit <= simdi).sort((a, b) => a[1].vakit - b[1].vakit);
      for (const [id, z] of gecmis) {
        zamanlayicilar.delete(id);
        await z.fn();
      }
    },
    bekleyen: () => zamanlayicilar.size,
  };
  return saat;
}

const TEMEL_VARLIKLAR = {
  'light.salon': { entity_id: 'light.salon', state: 'on', attributes: { friendly_name: 'Salon lambası', brightness: 200, color_mode: 'color_temp', color_temp_kelvin: 3000 } },
  'light.yatak': { entity_id: 'light.yatak', state: 'off', attributes: { friendly_name: 'Yatak lambası' } },
  'switch.priz': { entity_id: 'switch.priz', state: 'on', attributes: { friendly_name: 'Masa prizi' } },
  'fan.vantilator': { entity_id: 'fan.vantilator', state: 'on', attributes: { friendly_name: 'Vantilatör', percentage: 66 } },
  'scene.film': { entity_id: 'scene.film', state: 'unknown', attributes: { friendly_name: 'Film', entity_id: ['light.salon', 'switch.priz'] } },
  'button.pc_bilgisayari_kapat': { entity_id: 'button.pc_bilgisayari_kapat', state: 'unknown', attributes: { friendly_name: 'Bilgisayarı kapat' } },
  'light.kapi_lambasi': { entity_id: 'light.kapi_lambasi', state: 'on', attributes: { friendly_name: 'Kapı lambası' } },
};

const TEMEL_FAVORILER = [
  { entity_id: 'light.salon', ad: 'Salon lambası', parlaklik: true },
  { entity_id: 'light.yatak', ad: 'Yatak lambası' },
  { entity_id: 'switch.priz', ad: 'Masa prizi' },
  { entity_id: 'fan.vantilator', ad: 'Vantilatör' },
  { entity_id: 'scene.film', ad: 'Film' },
  { entity_id: 'button.pc_bilgisayari_kapat', ad: 'PC kapat' },
  { entity_id: 'light.kapi_lambasi', ad: 'Lamba' }, // HA'daki adı kapı kuralına takılır
];

/**
 * Sahte Home Assistant: durum tutar, GET /api/states[/kimlik] yanıtlar, POST /api/services/<alan>/<servis> çağrısının etkisini
 * durumlara uygular (ışık/anahtar/vantilatör aç-kapa-değiştir, parlaklık, renk, vantilatör yüzdesi, sahne) ve her isteği kaydeder.
 * Durum değişince depoya (varsa) yazar ve bildirir. izlenen (Set): verilirse yalnız bu kimliklerin değişimi depoya yazılır
 * (canlı bağlantıda yalnız izlenen kümenin olayları depoya gelir; izlenmeyen varlığın değişimi depoya yansımaz).
 */
function sahteHA({ varliklar = TEMEL_VARLIKLAR, saat, depo = null, sahneEtkileri = {}, izlenen = null } = {}) {
  const durum = new Map(Object.entries(structuredClone(varliklar)));
  const istekler = [];
  let sayac = 0;
  const kopya = (v) => structuredClone(v);

  function yansit(kimlik) {
    sayac += 1;
    const v = durum.get(kimlik);
    v.last_updated = new Date((saat ? saat.simdi() : 0) + sayac).toISOString();
    v.last_changed = v.last_updated;
    if (depo && (!izlenen || izlenen.has(kimlik))) {
      depo.guncelle(kopya(v));
      depo.bosalt();
    }
  }

  function etkiUygula(kimlik, alan, servis, g) {
    const v = durum.get(kimlik);
    if (!v) return;
    if (alan === 'scene' && servis === 'turn_on') {
      for (const [uye, hedef] of Object.entries(sahneEtkileri[kimlik] ?? {})) {
        const u = durum.get(uye);
        if (!u) continue;
        u.state = hedef.state ?? u.state;
        Object.assign(u.attributes, hedef.attributes ?? {});
        yansit(uye);
      }
      v.state = new Date(saat ? saat.simdi() : 0).toISOString();
      yansit(kimlik);
      return;
    }
    if (servis === 'toggle') v.state = v.state === 'on' ? 'off' : 'on';
    else if (servis === 'turn_off') v.state = 'off';
    else if (servis === 'turn_on') {
      v.state = 'on';
      if (g.brightness_pct !== undefined) v.attributes.brightness = Math.round((g.brightness_pct * 255) / 100);
      if (g.color_temp_kelvin !== undefined) {
        v.attributes.color_temp_kelvin = g.color_temp_kelvin;
        v.attributes.color_mode = 'color_temp';
        delete v.attributes.rgb_color;
      }
      if (g.rgb_color !== undefined) {
        v.attributes.rgb_color = g.rgb_color;
        v.attributes.color_mode = 'rgb';
        delete v.attributes.color_temp_kelvin;
      }
    } else if (servis === 'set_percentage') {
      v.attributes.percentage = g.percentage;
      v.state = g.percentage > 0 ? 'on' : 'off';
    }
    yansit(kimlik);
  }

  async function haIstek(yol, secenek = {}) {
    istekler.push({ yol, yontem: secenek.yontem ?? 'GET', govde: secenek.govde });
    let e = /^\/api\/states\/(.+)$/.exec(yol);
    if (e) {
      if (!durum.has(e[1])) throw Object.assign(new Error('x'), { tur: 'bulunamadi' });
      return kopya(durum.get(e[1]));
    }
    if (yol === '/api/states') return [...durum.values()].map(kopya);
    e = /^\/api\/services\/(\w+)\/(\w+)$/.exec(yol);
    if (e && secenek.yontem === 'POST') {
      const g = secenek.govde ?? {};
      const kimlikler = [].concat(g.entity_id ?? []);
      for (const k of kimlikler) etkiUygula(k, e[1], e[2], g);
      return kimlikler.filter((k) => durum.has(k)).map((k) => kopya(durum.get(k)));
    }
    return [];
  }

  return {
    haIstek,
    istekler,
    durum,
    postlar: () => istekler.filter((i) => i.yontem === 'POST'),
    /** Testin kendi araya girmesi: HA'da değişiklik (başka bir uygulama açtı/kapattı gibi); depoya da yansır. */
    degistir(kimlik, degisim) {
      const v = durum.get(kimlik);
      if (degisim.state !== undefined) v.state = degisim.state;
      Object.assign(v.attributes, degisim.attributes ?? {});
      yansit(kimlik);
    },
    ekle(varlik) {
      durum.set(varlik.entity_id, kopya(varlik));
      yansit(varlik.entity_id);
    },
    kaldir(kimlik) {
      durum.delete(kimlik);
    },
    /** Depoyu tüm durumlarla doldurur (canlı bağlantının ilk get_states yanıtı gibi). */
    depoyuDoldur(kimlikler = [...durum.keys()]) {
      for (const k of kimlikler) if (durum.has(k)) yansit(k);
    },
  };
}

/**
 * Gerçek eylem katmanı + sahte HA + sanal saat + depo. Eylem katmanının bağımlılıkları (bildirim, "son", onay) kaydedilir.
 * @returns {{katman, depo, ha, saat, ayarlar, bildirimler, sonlar, postlar: Function}}
 */
function eylemOrtami({ varliklar = TEMEL_VARLIKLAR, favoriler = TEMEL_FAVORILER, ayarlar = {}, canli = true, sahneEtkileri = {}, haSarmala = null, izlenen = null } = {}) {
  const saat = sahteSaat();
  const depo = durumDeposuOlustur({ gruplamaMs: 0, zaman: { setTimeout: () => 0, clearTimeout: () => {} } });
  const izlenenKume = izlenen ? new Set(izlenen) : null; // null: hepsi izleniyor (eski davranış)
  const ha = sahteHA({ varliklar, saat, depo, sahneEtkileri, izlenen: izlenenKume });
  const ayarNesnesi = { favoriler, etkinlikGecmisi: true, ...ayarlar };
  const bildirimler = [];
  const sonlar = [];
  const katman = eylemKatmaniOlustur({
    ayarlarAl: () => ayarNesnesi,
    depo,
    canliMi: () => canli,
    ...(izlenenKume ? { izlenenMi: (k) => izlenenKume.has(k) } : {}),
    haIstek: haSarmala ? haSarmala(ha.haIstek) : ha.haIstek,
    son: { ekle: (k) => sonlar.push(k) },
    geriBildirim: (b) => bildirimler.push(b),
    durumlariYenile: async () => {},
    onayDiyalogu: async () => true,
    onayAcikMi: () => false,
    onayBekleniyorBildir: () => {},
    karolariAl: () => yuzeyModeliOlustur({ favoriler: ayarNesnesi.favoriler, durumAl: (k) => depo.al(k) }).gruplar.flatMap((g) => g.karolar),
    gunluk: () => {},
    zaman: { setTimeout: saat.setTimeout },
    simdi: saat.simdi,
  });
  ha.depoyuDoldur(); // canlı bağlantı: ilk durumlar depoda
  return { katman, depo, ha, saat, ayarlar: ayarNesnesi, bildirimler, sonlar, postlar: ha.postlar };
}

module.exports = { sahteFs, sahteSaat, sahteHA, eylemOrtami, TEMEL_VARLIKLAR, TEMEL_FAVORILER };
