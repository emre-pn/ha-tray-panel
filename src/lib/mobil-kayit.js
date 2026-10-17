'use strict';

/**
 * Home Assistant mobile_app kaydı ve bildirim eylemleri (o-61; saf: ağ, Electron ve dosya sistemi dışarıdan verilir).
 *
 * Bu bilgisayar YALNIZ kullanıcı Ayarlar > Mobil bildirimler > "Kaydol" der ve onaylarsa HA'ya mobile_app cihazı olarak kaydolur:
 *  1. POST /api/mobile_app/registrations (kimlikli, korumalı `haIstek` yolundan; tek istek, ASLA yeniden denenmez). Yanıttaki webhook_id
 *     safeStorage ile şifreli dosyada tutulur (src/lib/anahtar-deposu.js); ayara, günlüğe, dışa aktarmaya, klasör eşitlemeye, hata
 *     metnine ve tanılama raporuna GİRMEZ. Şifreleme kullanılamıyorsa kayıt yapılmaz.
 *  2. WebSocket itme kanalı ('mobile_app/push_notification_channel', yalnız okuyan abonelik): gelen bildirimler src/lib/itme-bildirimi.js ile
 *     çözülüp Kapı Kuralı'ndan geçirilir ve gösterilir (düğmesiz: Windows bildirimi; düğmeli: küçük kart).
 *  3. Düğmeye basılınca webhook'a TEK tür ileti gider: {type:'fire_event', data:{event_type:'mobile_app_notification_action',
 *     event_data:{action, tag?}}} (HA'nın companion uygulamalarıyla aynı olay). webhookGovdesiGecerliMi bu biçimin DIŞINDAKİ her gövdeyi
 *     reddeder; eylem kimliği Kapı Kuralı'ndan geçmelidir. Hız sınırı: 500 ms'de bir, dakikada en çok 10.
 *  4. HİÇBİR sensör, konum ya da cihaz durumu HA'ya yollanmaz (register_sensor, update_sensor_states, update_location... yok).
 *
 * HA'da kayıt silme REST ucu yoktur: "Kaydı sil" bu bilgisayardaki kaydı (webhook kimliği) siler ve itme kanalını kapatır; HA'daki cihaz
 * girdisini kullanıcı HA'dan (Ayarlar > Cihazlar ve hizmetler > Mobile App) kaldırır. HA kaydın silindiğini bildirirse (itme kanalı
 * 'not_found' ya da webhook 410) yerel kayıt kendiliğinden temizlenir.
 *
 * Bu dosya hiçbir şey günlüğe yazmaz (gunluk yalnız sabit metinlerle çağrılır) ve webhook kimliğini hiçbir yere taşımaz.
 */

const { bildirimiCoz, eylemKimligiGuvenliMi, etiketDuzelt } = require('./itme-bildirimi');

const KAYIT_YOLU = '/api/mobile_app/registrations';
const OLAY_TURU = 'mobile_app_notification_action';
const KANAL_KOMUTU = 'mobile_app/push_notification_channel';
const WEBHOOK_KIMLIGI_DESENI = /^[A-Za-z0-9_-]{16,128}$/;
const CIHAZ_ADI_VARSAYILAN = 'Ev Paneli';
const CIHAZ_ADI_SINIRI = 40;
const ORTAK_PENCERE_MS = 60_000;
const EN_COK_GELEN = 12; // dakikada gösterilen bildirim sınırı (bozuk/düşman bir HA ekranı doldurmasın)
const EN_COK_GIDEN = 10; // dakikada HA'ya giden eylem sınırı
const GIDEN_ARALIK_MS = 500;

const duzNesneMi = (d) => !!d && typeof d === 'object' && !Array.isArray(d);
const kisaMetin = (m, en) => (typeof m === 'string' ? m.slice(0, en) : '');

/** Webhook kimliği biçimi (HA: 32 ya da 64 onaltılık karakter). */
function webhookKimligiGecerliMi(kimlik) {
  return typeof kimlik === 'string' && WEBHOOK_KIMLIGI_DESENI.test(kimlik);
}

/** Cihaz adı: kontrol karakterleri atılır, 40 karaktere kısalır; boşsa varsayılan. (Kapı Kuralı ayar katmanında ayrıca uygulanır.) */
function cihazAdiDuzelt(ham) {
  const temiz = typeof ham === 'string' ? ham.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ').replace(/\s+/g, ' ').trim() : '';
  return Array.from(temiz).slice(0, CIHAZ_ADI_SINIRI).join('') || CIHAZ_ADI_VARSAYILAN;
}

/**
 * mobile_app kayıt gövdesi. Şifreleme KAPALI (webhook gövdeleri düz JSON; yalnız fire_event gider), sensör yok.
 * @param {{ cihazAdi?: string, kimlik: { uygulamaKimligi: string, uygulamaAdi: string, surum: string, osSurumu?: string } }} girdi
 */
function kayitGovdesi({ cihazAdi, kimlik }) {
  return {
    app_id: kisaMetin(kimlik?.uygulamaKimligi, 100) || 'ev-paneli',
    app_name: kisaMetin(kimlik?.uygulamaAdi, 60) || CIHAZ_ADI_VARSAYILAN,
    app_version: kisaMetin(kimlik?.surum, 30) || '0',
    device_name: cihazAdiDuzelt(cihazAdi),
    manufacturer: CIHAZ_ADI_VARSAYILAN,
    model: 'Windows',
    os_name: 'Windows',
    os_version: kisaMetin(kimlik?.osSurumu, 40) || 'Windows',
    supports_encryption: false,
    app_data: { push_websocket_channel: true },
  };
}

/** Düğme eylemi için webhook gövdesi; geçersizse null. */
function eylemGovdesi(eylem, etiket) {
  if (!eylemKimligiGuvenliMi(eylem)) return null;
  const veri = { action: eylem };
  const e = etiketDuzelt(etiket);
  if (e !== null) veri.tag = e;
  return { type: 'fire_event', data: { event_type: OLAY_TURU, event_data: veri } };
}

const tamAnahtarlar = (nesne, izinli) => duzNesneMi(nesne) && Object.keys(nesne).every((a) => izinli.includes(a));

/**
 * Webhook'a gönderilebilecek TEK gövde biçimi: mobile_app_notification_action olayını tetikleyen fire_event. Başka her tür (sensör,
 * konum, çağrı...), fazladan alan ve Kapı Kuralı'ndan geçmeyen eylem kimliği reddedilir. ha-istemcisi.js webhookGonder son kapı olarak
 * bunu sınar.
 * @param {unknown} govde
 */
function webhookGovdesiGecerliMi(govde) {
  if (!tamAnahtarlar(govde, ['type', 'data']) || govde.type !== 'fire_event') return false;
  const veri = govde.data;
  if (!tamAnahtarlar(veri, ['event_type', 'event_data']) || veri.event_type !== OLAY_TURU) return false;
  const olayVerisi = veri.event_data;
  if (!tamAnahtarlar(olayVerisi, ['action', 'tag']) || !eylemKimligiGuvenliMi(olayVerisi.action)) return false;
  return olayVerisi.tag === undefined || etiketDuzelt(olayVerisi.tag) === olayVerisi.tag;
}

/**
 * @param {object} bag
 * @param {(yol: string, secenek: {yontem?: string, govde?: object, oncelik?: string}) => Promise<any>} bag.haIstek korumalı REST yolu (yalnız kayıt POST'u)
 * @param {(webhookKimligi: string, govde: object) => Promise<any>} bag.webhookGonder korumalı webhook yolu (ha-istemcisi.js); 410 durumunda durumKodu 410 ile fırlatır
 * @param {{ varMi: () => boolean, kullanilabilirMi: () => Promise<boolean>, anahtarAl: () => Promise<string|null>, yaz: (k: string) => Promise<void>, sil: () => Promise<any> }} bag.depo webhook kimliği deposu (anahtar-deposu.js)
 * @param {{ abone: (ileti: object, dinleyici: Function) => () => void, canliMi?: () => boolean }} bag.ws canlı bağlantı (ha-ws.js)
 * @param {() => boolean} bag.etkinMi ayar mobilBildirimler
 * @param {() => string} bag.cihazAdiAl ayar mobilCihazAdi
 * @param {{ uygulamaKimligi: string, uygulamaAdi: string, surum: string, osSurumu?: string } | (() => object)} bag.kimlik kayıt anında okunur (işlev olabilir)
 * @param {(bildirim: object) => void} bag.goster çözülmüş bildirim ({ baslik, mesaj, etiket, dugmeler })
 * @param {(etiket: string) => void} bag.temizle clear_notification
 * @param {(tur: 'kayit-yok'|'yetkisiz'|'destek-yok') => void} [bag.uyari] itme kanalı kalıcı olarak kapandı
 * @param {() => void} [bag.durumDegisti] Ayarlar durumu yenilensin
 * @param {() => number} [bag.simdi]
 * @param {(m: string) => void} [bag.gunluk] yalnız sabit metinler
 */
function mobilKayitOlustur({ haIstek, webhookGonder, depo, ws, etkinMi, cihazAdiAl, kimlik, goster, temizle, uyari = () => {}, durumDegisti = () => {}, simdi = () => Date.now(), gunluk = () => {} }) {
  let abonelikBirak = null;
  let abonelikSuruyor = false; // baslat() depoyu okurken ikinci çağrı ikinci abonelik açmasın
  let akis = null; // kanal kalıcı olarak kapandıysa neden: 'kayit-yok' | 'yetkisiz' | 'destek-yok'
  let kayitSuruyor = false;
  let sonBildirim = null;
  let dusenBildirim = 0;
  let gelenler = [];
  let gidenler = [];
  let sonGiden = 0;

  const degisti = () => {
    try {
      durumDegisti();
    } catch {
      /* dinleyici hatası kaydı etkilemesin */
    }
  };

  function uyar(tur) {
    try {
      uyari(tur);
    } catch {
      /* dinleyici hatası kaydı etkilemesin */
    }
  }

  function kanaliBirak() {
    const birak = abonelikBirak;
    abonelikBirak = null;
    if (typeof birak === 'function') {
      try {
        birak();
      } catch {
        /* abonelik zaten yok */
      }
    }
  }

  async function yerelKaydiSil() {
    try {
      return await depo.sil();
    } catch {
      return null;
    }
  }

  /** HA bu kaydı tanımıyor (cihaz HA'dan silinmiş): kanal kapanır, yerel kayıt temizlenir. */
  async function kayitDustu() {
    kanaliBirak();
    akis = 'kayit-yok';
    await yerelKaydiSil();
    degisti();
    uyar('kayit-yok');
  }

  function kanalHatasi(kod) {
    if (kod === 'not_found') {
      kayitDustu().catch(() => {});
    } else if (kod === 'unauthorized' || kod === 'unknown_command') {
      // ha-ws.js bu iki kodda aboneliği kendisi bırakır (yönetici/HA kullanıcısı uyuşmuyor ya da HA bu komutu bilmiyor)
      kanaliBirak();
      akis = kod === 'unauthorized' ? 'yetkisiz' : 'destek-yok';
      degisti();
      uyar(akis);
    }
  }

  function olayIsle(yuk) {
    if (!duzNesneMi(yuk)) return;
    if (typeof yuk.hata === 'string') {
      kanalHatasi(yuk.hata);
      return;
    }
    if (!duzNesneMi(yuk.olay)) return;
    const an = simdi();
    gelenler = gelenler.filter((z) => an - z >= 0 && an - z < ORTAK_PENCERE_MS);
    if (gelenler.length >= EN_COK_GELEN) {
      dusenBildirim += 1;
      return;
    }
    gelenler.push(an);
    const cozum = bildirimiCoz(yuk.olay);
    if (cozum.tur === 'goster') {
      sonBildirim = an;
      try {
        goster({ baslik: cozum.baslik, mesaj: cozum.mesaj, etiket: cozum.etiket, dugmeler: cozum.dugmeler });
      } catch {
        gunluk('Mobil bildirim gösterilemedi.');
      }
      degisti();
    } else if (cozum.tur === 'temizle') {
      try {
        temizle(cozum.etiket);
      } catch {
        gunluk('Mobil bildirim kapatılamadı.');
      }
    }
  }

  return {
    /** Ayarlar'a giden durum (sır YOK: webhook kimliği, adres, anahtar girmez). */
    durum() {
      const kayitli = depo.varMi() === true;
      const etkin = etkinMi() === true;
      let kanal = 'kapali';
      if (!kayitli) kanal = akis === 'kayit-yok' ? 'kayit-yok' : 'kayitsiz';
      else if (akis !== null) kanal = akis;
      else if (abonelikBirak) kanal = ws.canliMi?.() === true ? 'dinliyor' : 'bekliyor';
      return { kayitli, etkin, kanal, kayitSuruyor, sonBildirim, dusenBildirim };
    },

    /**
     * İtme kanalını açar (kayıtlı ve ayar açıksa); idempotent. Açılışta, ayar değişince ve kayıttan sonra çağrılır.
     * @returns {Promise<boolean>} kanal açık mı
     */
    async baslat() {
      if (abonelikBirak) return true;
      if (abonelikSuruyor) return false;
      if (etkinMi() !== true || depo.varMi() !== true) {
        degisti();
        return false;
      }
      abonelikSuruyor = true;
      try {
        let kimlikDegeri = null;
        try {
          kimlikDegeri = await depo.anahtarAl();
        } catch {
          kimlikDegeri = null;
        }
        if (!webhookKimligiGecerliMi(kimlikDegeri)) {
          gunluk('Mobil kayıt okunamadı.');
          return false;
        }
        if (abonelikBirak || etkinMi() !== true) return !!abonelikBirak; // bu arada kapatıldı / başka çağrı açtı
        akis = null;
        abonelikBirak = ws.abone({ type: KANAL_KOMUTU, webhook_id: kimlikDegeri, support_confirm: false }, olayIsle);
        return true;
      } finally {
        abonelikSuruyor = false;
        degisti();
      }
    },

    /** İtme kanalını kapatır (ayar kapandı, kayıt silindi, uygulama kapanıyor). */
    durdur() {
      kanaliBirak();
      degisti();
    },

    /**
     * HA'ya mobile_app cihazı olarak kaydolur (kullanıcı onayı çağıranda alınmıştır). Tek istek, yeniden deneme yok.
     * @returns {Promise<{ok: true, zatenKayitli?: true} | {ok: false, hata: string, durumKodu?: number, haDaOlustu?: true}>}
     *   hata: 'mesgul' | 'sifreleme' | 'yanit' | 'yazilamadi' | HaHatasi türü ('bulunamadi': mobile_app entegrasyonu HA'da yok, 'belirsiz'/'gecikti': yanıt gelmedi...)
     */
    async kaydol() {
      if (kayitSuruyor) return { ok: false, hata: 'mesgul' };
      if (depo.varMi() === true) return { ok: true, zatenKayitli: true };
      kayitSuruyor = true;
      degisti();
      try {
        if (!(await depo.kullanilabilirMi())) return { ok: false, hata: 'sifreleme' };
        let yanit;
        try {
          yanit = await haIstek(KAYIT_YOLU, { yontem: 'POST', govde: kayitGovdesi({ cihazAdi: cihazAdiAl(), kimlik: typeof kimlik === 'function' ? kimlik() : kimlik }), oncelik: 'yuksek' });
        } catch (hata) {
          const tur = typeof hata?.tur === 'string' ? hata.tur : 'bilinmiyor';
          return Number.isInteger(hata?.durumKodu) && hata.durumKodu > 0 ? { ok: false, hata: tur, durumKodu: hata.durumKodu } : { ok: false, hata: tur };
        }
        const webhookKimligi = duzNesneMi(yanit) ? yanit.webhook_id : null;
        if (!webhookKimligiGecerliMi(webhookKimligi)) return { ok: false, hata: 'yanit', haDaOlustu: true };
        try {
          await depo.yaz(webhookKimligi);
        } catch {
          return { ok: false, hata: 'yazilamadi', haDaOlustu: true };
        }
        akis = null;
        return { ok: true };
      } finally {
        kayitSuruyor = false;
        degisti();
      }
    },

    /** Yerel kaydı (webhook kimliği) siler ve kanalı kapatır; HA'daki cihaz girdisi HA'dan elle kaldırılır. */
    async kaydiSil() {
      kanaliBirak();
      const varDi = depo.varMi() === true;
      let sonuc;
      try {
        sonuc = await depo.sil();
      } catch {
        degisti();
        return { ok: false, hata: 'silinemedi' };
      }
      akis = null;
      degisti();
      return { ok: true, silindi: varDi || sonuc?.silindi === true };
    },

    /**
     * Kartın düğmesine basıldı: webhook'a tek bir mobile_app_notification_action olayı gider.
     * @returns {Promise<{ok: true} | {ok: false, hata: string}>} hata: 'gecersiz' | 'kapali' | 'kayitsiz' | 'cok-sik' | 'kayit-yok' | HaHatasi türü
     */
    async eylemGonder(eylem, etiket) {
      const govde = eylemGovdesi(eylem, etiket);
      if (govde === null || !webhookGovdesiGecerliMi(govde)) return { ok: false, hata: 'gecersiz' };
      if (etkinMi() !== true) return { ok: false, hata: 'kapali' };
      let webhookKimligi = null;
      try {
        webhookKimligi = await depo.anahtarAl();
      } catch {
        webhookKimligi = null;
      }
      if (!webhookKimligiGecerliMi(webhookKimligi)) return { ok: false, hata: 'kayitsiz' };
      const an = simdi();
      gidenler = gidenler.filter((z) => an - z >= 0 && an - z < ORTAK_PENCERE_MS);
      if (gidenler.length >= EN_COK_GIDEN || (an >= sonGiden && an - sonGiden < GIDEN_ARALIK_MS)) return { ok: false, hata: 'cok-sik' };
      gidenler.push(an);
      sonGiden = an;
      try {
        await webhookGonder(webhookKimligi, govde);
        return { ok: true };
      } catch (hata) {
        if (hata?.durumKodu === 410) {
          await kayitDustu();
          return { ok: false, hata: 'kayit-yok' };
        }
        return { ok: false, hata: typeof hata?.tur === 'string' ? hata.tur : 'bilinmiyor' };
      }
    },
  };
}

module.exports = {
  KAYIT_YOLU,
  OLAY_TURU,
  KANAL_KOMUTU,
  WEBHOOK_KIMLIGI_DESENI,
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
};
