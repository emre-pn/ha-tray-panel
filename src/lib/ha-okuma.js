'use strict';

/**
 * HA okuma uçları — 1.4.0 ortak güvenli altyapı (saf; ağ dışarıdan verilir, Electron'a bağlı değildir).
 *
 * Yalnız ANA SÜREÇTE çalışır; anahtar ve adres bu dosyaya hiç gelmez: REST istekleri main.js'in `haIstek`i (yetki kesici,
 * kimlikli kapı, tek doğrulama geçidi, yönlendirme yasağı) ile, WebSocket istekleri canlı bağlantının `komut` / `abone`
 * işlevleriyle (yalnız ha-ws-protokol.js'teki OKUMA/ABONELIK listesi) gider. HİÇBİR servis çağrılmaz (call_service yok).
 *
 * Her uç:
 *  - girdiyi doğrular (kimlik deseni, alan, aralık sınırları); geçersiz girdi ağa çıkmaz,
 *  - varlığı Kapı Kuralı'ndan geçirir (suzgec.js guvenliVarlikMi; HA'daki GÜNCEL durumla),
 *  - yanıttaki metinleri süzer (takvim/yapılacaklar başlığı, bildirim metni, alan adı: guvenliMetin) ve yalnız gerekli alanları döner,
 *  - hız sınırlıdır: uç+girdi başına önbellek (TTL) ve aynı istek sürerken ikinci istek ağa çıkmaz; küresel dakika sınırı,
 *  - HA yanıt vermezse, bağlantı yoksa ya da hata dönerse SESSİZCE boş döner (fırlatmaz); günlüğe yalnız sabit metin,
 *  - yönetici gerektirebilecek WS komutları 'unauthorized' (ya da 'unknown_command') dönerse o uç oturum boyunca kapanır.
 *
 * API (ajanlar için):
 *   gecmis(kimlikler, { saat } | { baslangic, bitis })  -> Promise<{ [kimlik]: {t: number(ms), d: number|string|null}[] }>
 *       REST /api/history/period (minimal_response, no_attributes, significant_changes_only); en çok 7 varlık, en uzun 7 gün,
 *       seri başına en çok 500 nokta (fazlası seyreltilir).
 *   takvimEtkinlikleri(kimlik, { gun } | { baslangic, bitis }) -> Promise<{baslik, baslangic, bitis, tumGun}[]>
 *       REST /api/calendars/<kimlik>?start&end; en uzun 31 gün, en çok 50 etkinlik; başlığı süzgeçten geçmeyen etkinlik düşer.
 *   havaTahmini(kimlik, tur = 'daily') -> Promise<{zaman, durum, sicaklik, enDusuk, yagis, yagisOlasiligi, nem, ruzgar}[]>
 *       WS weather/subscribe_forecast (ilk olay alınır, abonelik bırakılır); en çok 48 öğe. Canlı bağlantı yoksa boş.
 *   alanlar() -> Promise<{ alanlar: {id, ad}[], varlikAlanlari: { [kimlik]: alanId } }>
 *       WS config/area_registry/list + config/entity_registry/list_for_display (+ isteğe bağlı config/device_registry/list:
 *       kendi alanı olmayan varlık cihazının alanını alır). Adı süzgeçten geçmeyen alan listede yoktur.
 *   yapilacaklar(kimlik) -> Promise<{uid, baslik, tamamlandi}[]>  WS todo/item/list; en çok 100 öğe.
 *   yoneticiMi() -> Promise<boolean|null>  WS auth/current_user is_admin (o-43); bilinmiyorsa null.
 *   bildirimAboneOl(dinleyici) -> () => void  WS persistent_notification/subscribe; dinleyici süzülmüş liste alır:
 *       dinleyici({id, baslik, metin, zaman}[] (en yeni önce, en çok 20), { gizlenen: number }). Başlığı ya da metni süzgeçten
 *       geçmeyen bildirim HİÇ gösterilmez; yalnız sayısı `gizlenen` olarak verilir ("N gizlendi").
 *   kapaliUclar() -> string[]  oturum boyunca kapanmış uçlar (tanı için; sırsız)
 *
 * Test sahtesi: test/ha-okuma.test.js'teki sahteOkuma() (sahte haIstek + sahte ws.komut/abone + depo).
 */

const { VARLIK_KIMLIGI_DESENI } = require('./dogrulama');
const { alanAl, guvenliVarlikMi, guvenliMetin } = require('./suzgec');
const { kayitliAlanMi } = require('./alan-kaydi');
const { durumuDuzelt } = require('./ha-ws-protokol');
const { HAVA_DURUMLARI, sayiAl, isoAl } = require('./varlik-ozellik');

const SAAT_MS = 60 * 60 * 1000;
const GUN_MS = 24 * SAAT_MS;
const EN_COK_GECMIS_VARLIK = 7;
const EN_UZUN_GECMIS_MS = 7 * GUN_MS;
const EN_COK_NOKTA = 500;
const EN_UZUN_TAKVIM_MS = 31 * GUN_MS;
const EN_COK_ETKINLIK = 50;
const EN_COK_TAHMIN = 48;
const EN_COK_YAPILACAK = 100;
const EN_COK_BILDIRIM = 20;
const DAKIKA_SINIRI = 30; // tüm uçlar için dakikada en çok bu kadar ağ okuması (önbellekten dönenler sayılmaz)
const TTL = Object.freeze({ gecmis: 60_000, takvim: 120_000, hava: 600_000, alanlar: 300_000, yapilacak: 10_000, yonetici: 600_000, durum: 30_000 });
const TAHMIN_TURLERI = Object.freeze(['daily', 'hourly', 'twice_daily']);
const KAPATAN_KODLAR = new Set(['unauthorized', 'unknown_command']);
const ALAN_KIMLIGI_DESENI = /^[A-Za-z0-9_-]{1,64}$/;
const BILDIRIM_KIMLIGI_DESENI = /^[A-Za-z0-9_.:-]{1,100}$/;

const bos = Object.freeze({ dizi: () => [], nesne: () => ({}) });

/**
 * @param {object} bag
 * @param {(yol: string, secenek?: object) => Promise<unknown>} bag.haIstek main.js haIstek (yalnız GET kullanılır)
 * @param {{komut: Function, abone: Function, canliMi?: () => boolean}} bag.ws canlı bağlantı (ha-ws.js)
 * @param {(kimlik: string) => object|null|undefined} [bag.durumAl] durum deposu okuyucu (varsa REST'e gidilmez)
 * @param {() => number} [bag.simdi]
 * @param {(m: string) => void} [bag.gunluk] yalnız sabit metin
 * @param {{setTimeout: Function, clearTimeout: Function}} [bag.zaman]
 */
function haOkumaOlustur({ haIstek, ws, durumAl = () => undefined, simdi = () => Date.now(), gunluk = () => {}, zaman = { setTimeout: (f, ms) => globalThis.setTimeout(f, ms), clearTimeout: (id) => globalThis.clearTimeout(id) } }) {
  const onbellek = new Map(); // anahtar -> { t, deger }
  const surenler = new Map(); // anahtar -> Promise
  const kapali = new Set();
  let agOkumalari = []; // son 60 sn'deki ağ okumalarının zamanları

  function agHakkiVarMi() {
    const t = simdi();
    agOkumalari = agOkumalari.filter((z) => t - z < 60_000);
    if (agOkumalari.length >= DAKIKA_SINIRI) return false;
    agOkumalari.push(t);
    return true;
  }

  /**
   * Önbellekli, tek uçuşlu, hız sınırlı okuma. `is` fırlatırsa ya da hak yoksa `bosDeger()` döner (önbelleğe yazılmaz).
   * @param {string} uc TTL anahtarı
   */
  async function oku(uc, anahtar, is, bosDeger) {
    if (kapali.has(uc)) return bosDeger();
    const tam = `${uc}|${anahtar}`;
    const kayit = onbellek.get(tam);
    if (kayit && simdi() - kayit.t < TTL[uc]) return kayit.deger;
    if (surenler.has(tam)) return surenler.get(tam);
    if (!agHakkiVarMi()) return kayit ? kayit.deger : bosDeger();
    const soz = (async () => {
      try {
        const deger = await is();
        if (deger === undefined) return kayit ? kayit.deger : bosDeger(); // geçici sorun: önbelleğe yazılmaz
        if (onbellek.size > 200) onbellek.clear();
        onbellek.set(tam, { t: simdi(), deger });
        return deger;
      } catch {
        gunluk(`HA okuma ucu yanıt vermedi (${uc}); boş gösteriliyor.`);
        return kayit ? kayit.deger : bosDeger();
      } finally {
        surenler.delete(tam);
      }
    })();
    surenler.set(tam, soz);
    return soz;
  }

  /** WS komutu: başarısızsa undefined (geçici) ya da kapatan kodda uç kapanır. */
  async function wsKomut(uc, ileti) {
    if (typeof ws?.komut !== 'function') return undefined;
    const yanit = await ws.komut(ileti);
    if (yanit?.ok) return yanit.sonuc;
    if (KAPATAN_KODLAR.has(yanit?.kod)) {
      kapali.add(uc);
      gunluk(`HA okuma ucu kullanılamıyor (${uc}); özellik kapalı kalacak.`);
    }
    return undefined;
  }

  /** Varlığın GÜNCEL durumu (depo; yoksa REST, kısa önbellekli). Bulunamazsa null. */
  async function guncelVarlik(kimlik) {
    const d = durumAl(kimlik);
    if (d && typeof d === 'object') return d;
    return oku('durum', kimlik, async () => {
      try {
        return durumuDuzelt(await haIstek(`/api/states/${kimlik}`)) ?? null;
      } catch (hata) {
        if (hata?.tur === 'bulunamadi') return null;
        throw hata;
      }
    }, () => null);
  }

  /** Kimlik geçerli, alanı izinli ve varlık (HA'daki güncel hâliyle) Kapı Kuralı'ndan geçiyor mu? */
  async function izinliMi(kimlik, alanlar) {
    if (typeof kimlik !== 'string' || !VARLIK_KIMLIGI_DESENI.test(kimlik)) return false;
    const alan = alanAl(kimlik);
    if (!kayitliAlanMi(alan) || (alanlar && !alanlar.includes(alan))) return false;
    const varlik = await guncelVarlik(kimlik);
    return !!varlik && varlik.entity_id === kimlik && guvenliVarlikMi(varlik);
  }

  /** { saat } ya da { baslangic, bitis } -> [başlangıç, bitiş] ms; geçersizse null. */
  function aralikCoz(secenek, enUzunMs, varsayilanMs) {
    const g = secenek && typeof secenek === 'object' ? secenek : {};
    const t = simdi();
    let bitis = g.bitis === undefined ? t : Date.parse(g.bitis);
    let bas;
    if (g.baslangic !== undefined) bas = Date.parse(g.baslangic);
    else if (Number.isFinite(g.saat)) bas = bitis - g.saat * SAAT_MS;
    else if (Number.isFinite(g.gun)) bas = bitis - g.gun * GUN_MS;
    else bas = bitis - varsayilanMs;
    if (!Number.isFinite(bas) || !Number.isFinite(bitis)) return null;
    if (Math.abs(bitis - t) > 366 * GUN_MS || Math.abs(bas - t) > 366 * GUN_MS) return null;
    if (bitis - bas > enUzunMs) bas = bitis - enUzunMs;
    if (bas >= bitis) return null;
    bitis = Math.round(bitis);
    bas = Math.round(bas);
    return [bas, bitis];
  }

  function noktaDegeri(durum) {
    if (typeof durum !== 'string' || durum === 'unavailable' || durum === 'unknown') return null;
    const n = sayiAl(durum);
    if (n !== null) return n;
    return guvenliMetin(durum, 40);
  }

  function seyrelt(liste) {
    if (liste.length <= EN_COK_NOKTA) return liste;
    const adim = liste.length / EN_COK_NOKTA;
    const sonuc = [];
    for (let i = 0; i < EN_COK_NOKTA - 1; i += 1) sonuc.push(liste[Math.floor(i * adim)]);
    sonuc.push(liste.at(-1));
    return sonuc;
  }

  return {
    async gecmis(kimlikler, secenek = {}) {
      if (!Array.isArray(kimlikler) || kimlikler.length === 0 || kimlikler.length > EN_COK_GECMIS_VARLIK) return {};
      const benzersiz = [...new Set(kimlikler)];
      const aralik = aralikCoz(secenek, EN_UZUN_GECMIS_MS, 24 * SAAT_MS);
      if (!aralik) return {};
      for (const k of benzersiz) if (!(await izinliMi(k))) return {};
      const [bas, bitis] = aralik;
      // Önbellek anahtarı dakikaya yuvarlanır: art arda açılan grafik aynı isteği tekrarlamasın.
      const anahtar = `${[...benzersiz].sort().join(',')}|${Math.floor(bas / 60_000)}|${Math.floor(bitis / 60_000)}`;
      return oku('gecmis', anahtar, async () => {
        const yol =
          `/api/history/period/${encodeURIComponent(new Date(bas).toISOString())}` +
          `?filter_entity_id=${encodeURIComponent(benzersiz.join(','))}&end_time=${encodeURIComponent(new Date(bitis).toISOString())}` +
          '&minimal_response&no_attributes&significant_changes_only';
        const yanit = await haIstek(yol);
        if (!Array.isArray(yanit)) return {};
        const seriler = {};
        for (const seri of yanit) {
          if (!Array.isArray(seri) || seri.length === 0) continue;
          const kimlik = seri[0]?.entity_id;
          if (typeof kimlik !== 'string' || !benzersiz.includes(kimlik) || Object.hasOwn(seriler, kimlik)) continue;
          const noktalar = [];
          for (const n of seri) {
            const z = Date.parse(n?.last_changed ?? n?.last_updated);
            if (!Number.isFinite(z)) continue;
            noktalar.push({ t: z, d: noktaDegeri(n?.state) });
          }
          seriler[kimlik] = seyrelt(noktalar);
        }
        return seriler;
      }, bos.nesne);
    },

    async takvimEtkinlikleri(kimlik, secenek = {}) {
      const g = secenek && typeof secenek === 'object' ? secenek : {};
      const t = simdi();
      // Varsayılan: şimdiden ileriye `gun` gün (1..31, varsayılan 7); { baslangic, bitis } verilirse o aralık (en uzun 31 gün).
      const gun = Math.min(Math.max(Number.isFinite(g.gun) ? g.gun : 7, 1), 31);
      const ileri = { baslangic: new Date(t).toISOString(), bitis: new Date(t + gun * GUN_MS).toISOString() };
      const aralik = aralikCoz(g.baslangic === undefined ? ileri : g, EN_UZUN_TAKVIM_MS, 7 * GUN_MS);
      if (!aralik || !(await izinliMi(kimlik, ['calendar']))) return [];
      const [bas, bitis] = aralik;
      return oku('takvim', `${kimlik}|${Math.floor(bas / 60_000)}|${Math.floor(bitis / 60_000)}`, async () => {
        const yol = `/api/calendars/${kimlik}?start=${encodeURIComponent(new Date(bas).toISOString())}&end=${encodeURIComponent(new Date(bitis).toISOString())}`;
        const yanit = await haIstek(yol);
        if (!Array.isArray(yanit)) return [];
        const sonuc = [];
        for (const e of yanit) {
          if (sonuc.length >= EN_COK_ETKINLIK) break;
          const baslik = guvenliMetin(e?.summary, 100);
          if (!baslik) continue; // başlığı süzgeçten geçmeyen (ya da boş) etkinlik gösterilmez
          const tumGun = typeof e?.start?.date === 'string' && e.start.dateTime === undefined;
          const zamanAl = (z) => (tumGun ? (/^\d{4}-\d{2}-\d{2}$/.test(z?.date ?? '') ? z.date : null) : isoAl(z?.dateTime));
          const b = zamanAl(e.start);
          const s = zamanAl(e.end);
          if (!b) continue;
          sonuc.push({ baslik, baslangic: b, bitis: s, tumGun });
        }
        return sonuc;
      }, bos.dizi);
    },

    async havaTahmini(kimlik, tur = 'daily') {
      if (!TAHMIN_TURLERI.includes(tur) || typeof ws?.abone !== 'function') return [];
      if (!(await izinliMi(kimlik, ['weather']))) return [];
      return oku('hava', `${kimlik}|${tur}`, () =>
        new Promise((coz) => {
          let bitti = false;
          let birak = () => {};
          const bitir = (deger) => {
            if (bitti) return;
            bitti = true;
            zaman.clearTimeout(zamanlayici);
            birak();
            coz(deger);
          };
          const zamanlayici = zaman.setTimeout(() => bitir(undefined), 10_000);
          birak = ws.abone({ type: 'weather/subscribe_forecast', entity_id: kimlik, forecast_type: tur }, (yuk) => {
            if (yuk?.hata) {
              if (KAPATAN_KODLAR.has(yuk.hata)) kapali.add('hava');
              return bitir(undefined);
            }
            const liste = Array.isArray(yuk?.olay?.forecast) ? yuk.olay.forecast : null;
            if (!liste) return undefined;
            return bitir(
              liste.slice(0, EN_COK_TAHMIN).map((f) => ({
                zaman: isoAl(f?.datetime),
                durum: typeof f?.condition === 'string' && HAVA_DURUMLARI.includes(f.condition) ? f.condition : null,
                sicaklik: sayiAl(f?.temperature, { min: -100, max: 200 }),
                enDusuk: sayiAl(f?.templow, { min: -100, max: 200 }),
                yagis: sayiAl(f?.precipitation, { min: 0, max: 10_000 }),
                yagisOlasiligi: sayiAl(f?.precipitation_probability, { min: 0, max: 100 }),
                nem: sayiAl(f?.humidity, { min: 0, max: 100 }),
                ruzgar: sayiAl(f?.wind_speed, { min: 0, max: 1000 }),
              })),
            );
          });
          if (bitti) birak(); // abone hemen hata verdiyse
        }), bos.dizi);
    },

    async alanlar() {
      const bosAlan = () => ({ alanlar: [], varlikAlanlari: {} });
      return oku('alanlar', '', async () => {
        const alanListesi = await wsKomut('alanlar', { type: 'config/area_registry/list' });
        if (!Array.isArray(alanListesi)) return undefined;
        const kayitlar = await wsKomut('alanlar', { type: 'config/entity_registry/list_for_display' });
        const varliklar = Array.isArray(kayitlar?.entities) ? kayitlar.entities : null;
        if (!varliklar) return undefined;
        const cihazlar = await wsKomut('cihazlar', { type: 'config/device_registry/list' }); // isteğe bağlı: hata verirse yalnız cihaz alanı yok
        const alanlar = [];
        const gecerliAlanlar = new Set();
        for (const a of alanListesi) {
          if (alanlar.length >= 200) break;
          const id = typeof a?.area_id === 'string' && ALAN_KIMLIGI_DESENI.test(a.area_id) ? a.area_id : null;
          const ad = guvenliMetin(a?.name, 60);
          if (!id || !ad) continue; // adı süzgeçten geçmeyen alan ("Garaj") listede yok
          alanlar.push({ id, ad });
          gecerliAlanlar.add(id);
        }
        const cihazAlani = new Map();
        for (const c of Array.isArray(cihazlar) ? cihazlar : []) {
          if (typeof c?.id === 'string' && typeof c.area_id === 'string') cihazAlani.set(c.id, c.area_id);
        }
        const varlikAlanlari = {};
        for (const v of varliklar) {
          const kimlik = v?.ei;
          if (typeof kimlik !== 'string' || !VARLIK_KIMLIGI_DESENI.test(kimlik) || !kayitliAlanMi(alanAl(kimlik))) continue;
          const alanId = typeof v.ai === 'string' ? v.ai : typeof v.di === 'string' ? cihazAlani.get(v.di) : undefined;
          if (alanId && gecerliAlanlar.has(alanId)) varlikAlanlari[kimlik] = alanId;
        }
        return { alanlar, varlikAlanlari };
      }, bosAlan);
    },

    async yapilacaklar(kimlik) {
      if (!(await izinliMi(kimlik, ['todo']))) return [];
      return oku('yapilacak', kimlik, async () => {
        const sonuc = await wsKomut('yapilacak', { type: 'todo/item/list', entity_id: kimlik });
        if (!Array.isArray(sonuc?.items)) return undefined;
        const liste = [];
        for (const o of sonuc.items) {
          if (liste.length >= EN_COK_YAPILACAK) break;
          const baslik = guvenliMetin(o?.summary, 200);
          if (!baslik || typeof o?.uid !== 'string' || o.uid.length > 200) continue;
          liste.push({ uid: o.uid, baslik, tamamlandi: o.status === 'completed' });
        }
        return liste;
      }, bos.dizi);
    },

    async yoneticiMi() {
      return oku('yonetici', '', async () => {
        const sonuc = await wsKomut('yonetici', { type: 'auth/current_user' });
        return typeof sonuc?.is_admin === 'boolean' ? sonuc.is_admin : undefined;
      }, () => null);
    },

    bildirimAboneOl(dinleyici) {
      if (typeof dinleyici !== 'function' || typeof ws?.abone !== 'function' || kapali.has('bildirim')) return () => {};
      const bildirimler = new Map(); // id -> { id, baslik, metin, zaman }
      const gizli = new Set(); // süzgeçten geçmediği için gösterilmeyen bildirim kimlikleri (yalnız SAYISI dinleyiciye gider: "N gizlendi")
      const yay = () => {
        const liste = [...bildirimler.values()].sort((a, b) => (b.zaman ?? '').localeCompare(a.zaman ?? '')).slice(0, EN_COK_BILDIRIM);
        try {
          dinleyici(liste.map((b) => ({ ...b })), { gizlenen: gizli.size });
        } catch {
          /* dinleyici hatası aboneliği etkilemesin */
        }
      };
      return ws.abone({ type: 'persistent_notification/subscribe' }, (yuk) => {
        if (yuk?.hata) {
          if (KAPATAN_KODLAR.has(yuk.hata)) kapali.add('bildirim');
          return;
        }
        const olay = yuk?.olay;
        const tur = olay?.type;
        const ham = olay?.notifications;
        if (!['current', 'added', 'updated', 'removed'].includes(tur) || !ham || typeof ham !== 'object' || Array.isArray(ham)) return;
        if (tur === 'current') {
          bildirimler.clear();
          gizli.clear();
        }
        for (const [anahtar, b] of Object.entries(ham)) {
          const id = typeof b?.notification_id === 'string' ? b.notification_id : anahtar;
          if (!BILDIRIM_KIMLIGI_DESENI.test(id)) continue;
          if (tur === 'removed') {
            bildirimler.delete(id);
            gizli.delete(id);
            continue;
          }
          const metin = guvenliMetin(b?.message, 300);
          const baslik = b?.title === undefined || b?.title === null || b?.title === '' ? null : guvenliMetin(b.title, 100);
          // Metni ya da (varsa) başlığı süzgeçten geçmeyen bildirim HİÇ gösterilmez ("Garaj kapısı açık kaldı"); yalnız sayılır.
          if (!metin || (b?.title && !baslik)) {
            bildirimler.delete(id);
            if (gizli.size < 200) gizli.add(id);
            continue;
          }
          gizli.delete(id);
          if (bildirimler.size >= 50 && !bildirimler.has(id)) continue;
          bildirimler.set(id, { id, baslik, metin, zaman: isoAl(b?.created_at) });
        }
        yay();
      });
    },

    kapaliUclar: () => [...kapali].sort(),
  };
}

const YUZEY_OKUMA_TURLERI = Object.freeze(['gecmis', 'takvim', 'hava', 'yapilacak']);

/**
 * Panel/palet'ten gelen okuma isteği (yuzey:oku IPC; yük renderer'dan gelir, güvenilmez). Her kimlik KAYITLI olmalıdır
 * (favori ya da eylem.kayitKaynagiEkle ile eklenmiş Ayarlar seçimi): renderer serbest bir varlığı okutamaz.
 * Yük biçimleri:
 *   { tur: 'gecmis', kimlikler: string[] (1..7), saat?: 1..168 }
 *   { tur: 'takvim', kimlik, gun?: 1..31 }
 *   { tur: 'hava', kimlik, tahmin?: 'daily'|'hourly'|'twice_daily' }
 *   { tur: 'yapilacak', kimlik }
 * @param {ReturnType<typeof haOkumaOlustur>} okuma
 * @param {unknown} yuk
 * @param {(kimlik: string) => boolean} kayitliMi
 * @returns {Promise<{ok: true, veri: unknown} | {ok: false, tur: 'gecersiz'|'kayitsiz'}>}
 */
async function yuzeyOkumasi(okuma, yuk, kayitliMi) {
  if (!yuk || typeof yuk !== 'object' || Array.isArray(yuk) || !YUZEY_OKUMA_TURLERI.includes(yuk.tur)) return { ok: false, tur: 'gecersiz' };
  const kimlikGecerli = (k) => typeof k === 'string' && k.length <= 120 && VARLIK_KIMLIGI_DESENI.test(k);
  if (yuk.tur === 'gecmis') {
    const liste = yuk.kimlikler;
    if (!Array.isArray(liste) || liste.length === 0 || liste.length > EN_COK_GECMIS_VARLIK || !liste.every(kimlikGecerli)) return { ok: false, tur: 'gecersiz' };
    if (!liste.every((k) => kayitliMi(k))) return { ok: false, tur: 'kayitsiz' };
    const saat = Number.isInteger(yuk.saat) && yuk.saat >= 1 && yuk.saat <= 168 ? yuk.saat : 24;
    return { ok: true, veri: await okuma.gecmis(liste, { saat }) };
  }
  if (!kimlikGecerli(yuk.kimlik)) return { ok: false, tur: 'gecersiz' };
  if (!kayitliMi(yuk.kimlik)) return { ok: false, tur: 'kayitsiz' };
  if (yuk.tur === 'takvim') {
    const gun = Number.isInteger(yuk.gun) && yuk.gun >= 1 && yuk.gun <= 31 ? yuk.gun : 7;
    return { ok: true, veri: await okuma.takvimEtkinlikleri(yuk.kimlik, { gun }) };
  }
  if (yuk.tur === 'hava') {
    const tur = TAHMIN_TURLERI.includes(yuk.tahmin) ? yuk.tahmin : 'daily';
    return { ok: true, veri: await okuma.havaTahmini(yuk.kimlik, tur) };
  }
  return { ok: true, veri: await okuma.yapilacaklar(yuk.kimlik) };
}

module.exports = {
  YUZEY_OKUMA_TURLERI,
  yuzeyOkumasi,
  EN_COK_GECMIS_VARLIK,
  EN_UZUN_GECMIS_MS,
  EN_COK_NOKTA,
  EN_UZUN_TAKVIM_MS,
  DAKIKA_SINIRI,
  TAHMIN_TURLERI,
  haOkumaOlustur,
};
