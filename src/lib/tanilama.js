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
 *    Ayrıca her ana bilgisayar adı (FQDN; dosya adı uzantıları hariç), ayarlardaki adreslerin ana bilgisayar adları ve çağıranın verdiği Windows
 *    kullanıcı adı (boşluklu da) tam eşleşmeyle maskelenir.
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

/**
 * Erişim anahtarının kullanıcısı (Home Assistant auth/current_user is_admin; o-43). Yalnız true/false/bilinmiyor yazılır; kullanıcı adı,
 * kimliği ya da başka bir ayrıntı rapora girmez.
 */
function anahtarKullanicisiMetni(anahtarVar, yonetici) {
  if (anahtarVar !== true) return 'not applicable (no key added)';
  if (yonetici === true) return 'administrator (a non-administrator user is recommended)';
  if (yonetici === false) return 'non-administrator (recommended)';
  return 'not checked';
}

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

// Genel ana bilgisayar adı (FQDN): en az bir nokta, son etiket yalnız harf (sürüm numaraları ve IP sanılmaz). Dosya adı uzantıları hariç tutulur
// (ayarlar.json, main.js...): günlükte uygulamanın kendi dosya adları okunur kalsın. Aşırı maskeleme güvenli taraftır.
const FQDN_DESENI = /\b(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+([A-Za-z]{2,24})\b(?::\d{1,5})?/g;
const DOSYA_UZANTILARI = new Set(['json', 'js', 'mjs', 'cjs', 'log', 'tmp', 'txt', 'exe', 'dll', 'node', 'asar', 'md', 'png', 'ico', 'svg', 'jpg', 'html', 'css', 'bak', 'lock', 'yml']);
const EN_AZ_MASKE_UZUNLUGU = 3; // 1-2 harflik ad ("ha", "al") sıradan sözcükleri bozacağından serbest metinde aranmaz
const MASKE_ETIKETLERI = new Set(['url', 'host', 'user', 'entity', 'masked', 'ip6']); // "[user]" adlı bir kullanıcı maske etiketini yeniden maskelemesin

const regexKacis = (m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Adres ayarındaki ana bilgisayar adı (http/https değilse ya da adres geçersizse boş). */
function adresAnaBilgisayari(adres) {
  if (typeof adres !== 'string' || adres.trim() === '') return '';
  try {
    const u = new URL(adres.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.hostname.toLowerCase() : '';
  } catch {
    return '';
  }
}

/**
 * Bu bilgisayara ve ayarlara özgü maskeyi (kullanıcı adları, ayardaki ana bilgisayar adları) tek sefer derler.
 * @param {{ kullaniciAdlari?: unknown[], adresler?: unknown[] }} g
 * @returns {{ kullanici: RegExp|null, anaBilgisayar: RegExp|null }}
 */
function maskeKur({ kullaniciAdlari = [], adresler = [] } = {}) {
  const tekil = (liste) => [...new Set(liste)].sort((a, b) => b.length - a.length); // uzun ad önce: "emre sav" "emre"den önce
  const adlar = tekil(
    (Array.isArray(kullaniciAdlari) ? kullaniciAdlari : [])
      .filter((a) => typeof a === 'string')
      .map((a) => a.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ').trim().replace(/\s+/g, ' '))
      .filter((a) => a.length >= EN_AZ_MASKE_UZUNLUGU && !MASKE_ETIKETLERI.has(a.toLowerCase())),
  );
  const bilgisayarlar = tekil(
    (Array.isArray(adresler) ? adresler : [])
      .map(adresAnaBilgisayari)
      .filter((h) => h.length >= EN_AZ_MASKE_UZUNLUGU && !h.startsWith('[') && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(h) && !MASKE_ETIKETLERI.has(h)), // IP'ler kendi kuralıyla ([ip], [ip6]) maskelenir
  );
  return {
    // Harf/rakam/alt çizgi sınırı: "emre" adı "emresin" içinde değil, yalnız tek başına eşleşir. Addaki boşluk, satırdaki boşluk grubuyla eşleşir.
    kullanici: adlar.length > 0 ? new RegExp(`(?<![\\p{L}\\p{N}_])(?:${adlar.map((a) => regexKacis(a).replace(/ /g, '\\s+')).join('|')})(?![\\p{L}\\p{N}_])`, 'giu') : null,
    anaBilgisayar: bilgisayarlar.length > 0 ? new RegExp(`(?<![\\p{L}\\p{N}_-])(?:${bilgisayarlar.map(regexKacis).join('|')})(?![\\p{L}\\p{N}_-])(?::\\d{1,5})?`, 'giu') : null,
  };
}

/**
 * Tek günlük satırını rapora girecek hale getirir: sır temizliği (sirTemizle) + adres, ağ adı, kullanıcı adı/klasörü ve varlık kimliği maskesi.
 * Sıra önemlidir: URL önce, ayara özgü adlar sonra (boşluklu kullanıcı adı yol maskesinden önce bütün yakalanmalı), IP ve genel ad en sonda.
 * @param {unknown} satir
 * @param {{ kullanici?: RegExp|null, anaBilgisayar?: RegExp|null }} [maske] maskeKur() sonucu (verilmezse yalnız genel kurallar)
 */
function satiriTemizle(satir, maske = {}) {
  let s = sirTemizle(typeof satir === 'string' ? satir : '');
  s = s.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ');
  s = s.replace(/\bhttps?:\/\/[^\s)'"<>]+/gi, '[url]');
  if (maske?.anaBilgisayar) s = s.replace(maske.anaBilgisayar, '[host]');
  if (maske?.kullanici) s = s.replace(maske.kullanici, '[user]');
  s = s.replace(/\b(?:[A-Za-z0-9_-]+\.)+(?:local|lan|home\.arpa|localhost)\b/gi, '[host]');
  s = s.replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?\b/g, '[ip]');
  s = s.replace(/\[?(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}\]?/gi, (e) => (/^\d{1,2}:\d{2}(:\d{2})?$/.test(e) ? e : '[ip6]'));
  s = s.replace(/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/\s]+/gi, '$1[user]');
  s = s.replace(/(\/(?:Users|home)\/)[^/\s]+/g, '$1[user]');
  s = s.replace(new RegExp(`\\b(${HA_ALANLARI})\\.[a-z0-9_]+\\b`, 'g'), '$1.[entity]');
  s = s.replace(FQDN_DESENI, (eslesme, uzanti) => (DOSYA_UZANTILARI.has(uzanti.toLowerCase()) ? eslesme : '[host]'));
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
 * Dış tetikler satırı (1.4.0 dis grubu). Yalnız açık/kapalı ve sayılar yazılır: favori adı, kimlik, port, bağlantı ya da yerel API jetonu
 * girmez (özetteki başka alanlar okunmaz). Özet yoksa satır da yok (eski çağrılar bozulmaz).
 * @param {object|null} d
 * @returns {string[]}
 */
function disTetikSatiri(d) {
  if (!d || typeof d !== 'object') return [];
  const ac = (v) => (v === true ? 'on' : 'off');
  const sayi = (v) => (Number.isInteger(v) && v >= 0 ? Math.min(v, 1000) : 0);
  const api = d.yerelApi === true ? ` (${d.apiCalisiyor === true ? 'running' : 'not running'})` : '';
  return [
    `External triggers: Jump List ${ac(d.jumpList)}, desktop shortcut ${ac(d.masaustu)}, evpaneli:// link ${ac(d.protokol)} (${sayi(d.protokolIzinSayisi)} allowed),` +
      ` local API ${ac(d.yerelApi)}${api}, PC events ${ac(d.pcOlaylari)} (${sayi(d.pcKuralSayisi)} rules), meeting light ${ac(d.toplanti)}`,
  ];
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
 * @param {boolean|null} [g.anahtarYonetici] anahtarın kullanıcısı yönetici mi (auth/current_user is_admin); bilinmiyorsa null (o-43)
 * @param {number} g.hataliDeneme hata bütçesi sayacı
 * @param {string|null} g.yetkiKaydiSorunu 'yazilamadi' | 'okunamadi' | null
 * @param {number|null} g.sonBasari son başarılı HA yanıtının zamanı (ms)
 * @param {string[]} g.gunlukSatirlari ham günlük satırları
 * @param {string[]} [g.kullaniciAdlari] bu bilgisayardaki Windows kullanıcı adı (os.userInfo().username) ve kullanıcı klasörü adı; günlükte
 *   (boşluklu adlar dahil) görünürse [user] olur. yerelAdres/disAdres'in ana bilgisayar adları da günlükte [host] olur.
 * @param {object|null} [g.disTetikler] 1.4.0 dis grubu: src/dis-tetikler.js tanilamaOzeti() (yalnız açık/kapalı ve sayılar okunur)
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
  anahtarYonetici = null,
  hataliDeneme = 0,
  yetkiKaydiSorunu = null,
  sonBasari = null,
  gunlukSatirlari = [],
  kullaniciAdlari = [],
  disTetikler = null,
}) {
  const an = simdi instanceof Date ? simdi : new Date();
  const maske = maskeKur({ kullaniciAdlari, adresler: [yerelAdres, disAdres] });
  const satirlar = (Array.isArray(gunlukSatirlari) ? gunlukSatirlari : [])
    .slice(-SINIRLAR.gunlukSatiri)
    .map((satir) => satiriTemizle(satir, maske))
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
    `Key user: ${anahtarKullanicisiMetni(anahtarVar, anahtarYonetici)}`,
    ...disTetikSatiri(disTetikler),
    '',
    `Recent log lines (${satirlar.length}; secrets, addresses and device names masked):`,
    ...(satirlar.length > 0 ? satirlar : ['(log is empty or unreadable)']),
    '',
  ].join('\n');
  return { metin, gunlukSatiri: satirlar.length };
}

module.exports = { SINIRLAR, adresSinifi, adresSinifiMetni, maskeKur, satiriTemizle, sonSatirlar, gunlukSonSatirlari, raporOlustur };
