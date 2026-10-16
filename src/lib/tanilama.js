'use strict';

/**
 * Tanılama raporu (o-41; saf — dosya sistemi ve uygulama durumu dışarıdan verilir, Electron'a bağlı değildir).
 *
 * Sorun bildirirken eksik bilgi sorusu azalsın diye sürüm, Windows yapısı, adres SINIFI, bağlantı kipi, yetki kesici durumu, hatalı deneme
 * sayısı, son başarı ve günlüğün son satırları tek metinde toplanır. Metin kullanıcıya ÖNİZLENİR; panoya yazma ve yapıştırma kullanıcıdadır.
 *
 * Gizlilik (rapor herkese açık bir sorun kaydına yapıştırılabilir):
 *  - Erişim anahtarı rapora hiç girmez (yalnız "eklenmiş mi" bilgisi). Bu modül anahtarı hiç görmez.
 *  - Adres kişisel veridir: tam adres, ana bilgisayar adı ve IP rapora girmez; yalnız SINIFI yazılır (özel IP, yerel ad (.local...), genel ad,
 *    genel IP) ve http/https bilgisi eklenir.
 *  - Günlük satırları sirTemizle'den (anahtar, JWT, Bearer, webhook kimliği...) geçer; ayrıca URL, IPv4/IPv6, yerel ağ adları, Windows kullanıcı
 *    klasörü, HA varlık kimlikleri ve anahtar parmak izi öneki maskelenir (savunma derinliği; uygulama günlüğe zaten yalnız güvenli metin yazar).
 *  - Günlük dosyasının yolu rapora girmez.
 * Rapor dili sabit İngilizcedir (sorun kaydı dili; arayüz diline göre değişmez).
 */

const { sirTemizle } = require('./gunluk');
const { ozelAgAdiMi } = require('./dogrulama');

const SINIRLAR = Object.freeze({
  gunlukSatiri: 40, // rapora giren günlük satırı sayısı
  satirUzunlugu: 300,
  surumMetni: 40,
  okunacakBayt: 512 * 1024, // günlük dosyası en çok 256 KB döner; yine de okuma sınırlıdır
});

const PAKET_TURLERI = Object.freeze({ kurulu: 'installed', tasinabilir: 'portable', gelistirme: 'development' });
const BAGLANTI_KIPLERI = Object.freeze({ yerel: 'home network', dis: 'external address' });
const YETKI_DURUMLARI = Object.freeze({
  reddedildi: 'rejected by Home Assistant',
  dogrulanamadi: 'could not be verified',
  'kayit-onayi': 'waiting for confirmation (breaker record unreliable)',
  'yerel-yasak': 'home address blocked (HTTP 403)',
});
const KAYIT_SORUNLARI = Object.freeze({ yazilamadi: 'record not writable', okunamadi: 'record not readable' });

/** Etiketsiz ve kontrol karaktersiz, kısaltılmış metin; geçersizse yedek. */
function sinirliMetin(deger, n, yedek = 'unknown') {
  if (typeof deger !== 'string') return yedek;
  const temiz = deger.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ').trim().slice(0, n);
  return temiz === '' ? yedek : temiz;
}

/** Sürüm benzeri alan (1.3.0, 10.0.26300, 41.0.0-beta.1): yalnız güvenli karakterler; başka bir şey ise "unknown". */
function surumMetni(deger) {
  const metin = sinirliMetin(typeof deger === 'number' ? String(deger) : deger, SINIRLAR.surumMetni, '');
  return /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/.test(metin) ? metin : 'unknown';
}

/**
 * Adres sınıfı. Tam adres, ana bilgisayar adı ve IP DÖNMEZ.
 * @param {unknown} adres "http(s)://host[:port]" (kayıtlı ayar)
 * @returns {{ sinif: 'yok'|'gecersiz'|'ozel-ip'|'yerel-ad'|'genel-ip'|'genel-ad', sema: 'http'|'https'|null }}
 */
function adresSinifi(adres) {
  if (typeof adres !== 'string' || adres.trim() === '') return { sinif: 'yok', sema: null };
  let u;
  try {
    u = new URL(adres.trim());
  } catch {
    return { sinif: 'gecersiz', sema: null };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { sinif: 'gecersiz', sema: null };
  const sema = u.protocol === 'https:' ? 'https' : 'http';
  const ana = u.hostname.toLowerCase();
  const ozel = ozelAgAdiMi(ana);
  if (ana.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(ana)) return { sinif: ozel ? 'ozel-ip' : 'genel-ip', sema };
  return { sinif: ozel ? 'yerel-ad' : 'genel-ad', sema };
}

const SINIF_METINLERI = Object.freeze({
  yok: 'not set',
  gecersiz: 'invalid',
  'ozel-ip': 'private IP',
  'yerel-ad': 'local name (.local, .lan or single label)',
  'genel-ip': 'public IP',
  'genel-ad': 'public name',
});

/** "private IP, http" biçiminde tek satırlık metin (adresin kendisi yok). */
function adresSinifiMetni(adres) {
  const { sinif, sema } = adresSinifi(adres);
  return sema ? `${SINIF_METINLERI[sinif]}, ${sema}` : SINIF_METINLERI[sinif];
}

// --- Günlük satırı maskeleme --------------------------------------------------------------------------------------------------

const HA_ALANLARI = 'light|switch|scene|script|button|input_boolean|input_button|input_number|input_select|input_text|media_player|cover|fan|climate|lock|alarm_control_panel|automation|sensor|binary_sensor|camera|vacuum|humidifier|water_heater|valve|siren|remote|number|select|group|sun|weather|person|zone|device_tracker|update|event|todo|calendar|notify|tts|text|datetime|time|date|image|lawn_mower|air_quality|schedule|timer|counter';

/**
 * Tek günlük satırını rapora girecek hale getirir: sır temizliği (sirTemizle) + adres, ağ adı, kullanıcı klasörü ve varlık kimliği maskesi.
 * Sıra önemlidir: URL önce, IP ve ad sonra.
 */
function satiriTemizle(satir) {
  let s = sirTemizle(typeof satir === 'string' ? satir : '');
  s = s.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ');
  s = s.replace(/\bhttps?:\/\/[^\s)'"<>]+/gi, '[url]');
  s = s.replace(/\b(?:[A-Za-z0-9_-]+\.)+(?:local|lan|home\.arpa|localhost)\b/gi, '[host]');
  s = s.replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?\b/g, '[ip]');
  s = s.replace(/\[?(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}\]?/gi, (e) => (/^\d{1,2}:\d{2}(:\d{2})?$/.test(e) ? e : '[ip6]'));
  s = s.replace(/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/\s]+/gi, '$1[user]');
  s = s.replace(/(\/(?:Users|home)\/)[^/\s]+/g, '$1[user]');
  s = s.replace(new RegExp(`\\b(${HA_ALANLARI})\\.[a-z0-9_]+\\b`, 'g'), '$1.[entity]');
  s = s.replace(/(parmak izi=)[0-9a-f]+/gi, '$1[masked]');
  s = s.replace(/\s{2,}/g, ' ').trim();
  return s.length > SINIRLAR.satirUzunlugu ? `${s.slice(0, SINIRLAR.satirUzunlugu)}…` : s;
}

/** Günlük içeriğinden son `enFazla` dolu satırı döndürür (temizlenmemiş; satiriTemizle ayrıca uygulanır). */
function sonSatirlar(icerik, enFazla) {
  if (typeof icerik !== 'string') return [];
  const satirlar = icerik.split(/\r?\n/).filter((s) => s.trim() !== '');
  return satirlar.slice(-enFazla);
}

/**
 * Günlük dosyasının (ve gerekirse bir önceki dönüşünün) son satırlarını okur. Okunamazsa boş liste: rapor yine de üretilir.
 * @param {{ fs: object, yol: string|null, eskiYol?: string|null, enFazla?: number }} g
 * @returns {string[]} ham satırlar (eskiden yeniye)
 */
function gunlukSonSatirlari({ fs, yol, eskiYol = null, enFazla = SINIRLAR.gunlukSatiri }) {
  const oku = (dosya) => {
    if (typeof dosya !== 'string' || dosya === '') return [];
    try {
      const boyut = fs.statSync(dosya).size;
      const fd = fs.openSync(dosya, 'r');
      try {
        const okunacak = Math.min(boyut, SINIRLAR.okunacakBayt);
        const tampon = Buffer.alloc(okunacak);
        fs.readSync(fd, tampon, 0, okunacak, boyut - okunacak);
        return sonSatirlar(tampon.toString('utf8'), enFazla);
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return [];
    }
  };
  const yeni = oku(yol);
  if (yeni.length >= enFazla) return yeni;
  return [...oku(eskiYol).slice(-(enFazla - yeni.length)), ...yeni];
}

function sonBasariMetni(sonBasari, simdi) {
  if (!Number.isFinite(sonBasari) || sonBasari <= 0) return 'never in this session';
  const dakika = Math.max(0, Math.round((simdi.getTime() - sonBasari) / 60_000));
  return `${new Date(sonBasari).toISOString()} (${dakika} min ago)`;
}

/**
 * Raporu kurar.
 * @param {object} g
 * @param {Date} g.simdi
 * @param {string} g.uygulamaSurumu
 * @param {'kurulu'|'tasinabilir'|'gelistirme'} g.paketTuru
 * @param {{ electron?: string, chrome?: string, node?: string }} g.surumler
 * @param {{ platform?: string, surum?: string, mimari?: string }} g.isletimSistemi
 * @param {string|null} g.yerelAdres kayıtlı ev içi adres (yalnız sınıfı yazılır)
 * @param {string|null} g.disAdres kayıtlı dış adres (yalnız sınıfı yazılır)
 * @param {'yerel'|'dis'|null} g.baglantiTuru
 * @param {boolean} g.canli WebSocket canlı mı
 * @param {boolean} g.anahtarVar erişim anahtarı eklenmiş mi (değeri değil)
 * @param {string|null} g.yetkiDurumu yetki kesici durumu
 * @param {number} g.hataliDeneme hata bütçesi sayacı
 * @param {string|null} g.yetkiKaydiSorunu 'yazilamadi' | 'okunamadi' | null
 * @param {number|null} g.sonBasari son başarılı HA yanıtının zamanı (ms)
 * @param {string[]} g.gunlukSatirlari ham günlük satırları
 * @returns {{ metin: string, gunlukSatiri: number }}
 */
function raporOlustur({
  simdi,
  uygulamaSurumu,
  paketTuru,
  surumler = {},
  isletimSistemi = {},
  yerelAdres = null,
  disAdres = null,
  baglantiTuru = null,
  canli = false,
  anahtarVar = false,
  yetkiDurumu = null,
  hataliDeneme = 0,
  yetkiKaydiSorunu = null,
  sonBasari = null,
  gunlukSatirlari = [],
}) {
  const an = simdi instanceof Date ? simdi : new Date();
  const satirlar = (Array.isArray(gunlukSatirlari) ? gunlukSatirlari : [])
    .slice(-SINIRLAR.gunlukSatiri)
    .map(satiriTemizle)
    .filter((s) => s !== '');
  const platform = sinirliMetin(isletimSistemi.platform, 20);
  const os = platform === 'win32' ? 'Windows' : platform;
  const anahtarDurumu = !anahtarVar ? 'no key added' : yetkiDurumu ? YETKI_DURUMLARI[yetkiDurumu] ?? 'unknown' : 'ok';
  const sayac = Number.isInteger(hataliDeneme) && hataliDeneme >= 0 ? Math.min(hataliDeneme, 1000) : 0;
  const metin = [
    'Ev Paneli / Home Panel diagnostics report',
    `Created: ${an.toISOString()}`,
    `App version: ${surumMetni(uygulamaSurumu)} (${PAKET_TURLERI[paketTuru] ?? 'unknown'} build)`,
    `Electron: ${surumMetni(surumler.electron)}, Chrome: ${surumMetni(surumler.chrome)}, Node: ${surumMetni(surumler.node)}`,
    `System: ${os} ${surumMetni(isletimSistemi.surum)}, ${sinirliMetin(isletimSistemi.mimari, 20)}`,
    '',
    `Home address: ${adresSinifiMetni(yerelAdres)}`,
    `External address: ${adresSinifiMetni(disAdres)}`,
    `Connection: ${BAGLANTI_KIPLERI[baglantiTuru] ?? 'none'}`,
    `Live updates (WebSocket): ${canli === true ? 'connected' : 'not connected'}`,
    `Access key: ${anahtarVar === true ? 'added' : 'not added'} (the key itself is never included)`,
    `Key status: ${anahtarDurumu}`,
    `Failed sign-in attempts counted: ${sayac}`,
    `Breaker record: ${yetkiKaydiSorunu ? KAYIT_SORUNLARI[yetkiKaydiSorunu] ?? 'unknown' : 'ok'}`,
    `Last successful contact: ${sonBasariMetni(sonBasari, an)}`,
    '',
    `Recent log lines (${satirlar.length}; secrets, addresses and device names masked):`,
    ...(satirlar.length > 0 ? satirlar : ['(log is empty or unreadable)']),
    '',
  ].join('\n');
  return { metin, gunlukSatiri: satirlar.length };
}

module.exports = { SINIRLAR, adresSinifi, adresSinifiMetni, satiriTemizle, sonSatirlar, gunlukSonSatirlari, raporOlustur };
