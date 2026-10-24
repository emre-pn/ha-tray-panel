'use strict';

/**
 * Eylem sınıflandırması ve yüzeye göre izin (saf; Electron'a bağlı değildir) — hata-04.
 *
 *  YASAK    GÜVENLİK KURALI'ndan geçmeyen (kapı, kilit, alarm...) hiçbir yüzeyde çalışmaz.
 *  YIKICI   PC kapat/yeniden başlat, HA yeniden başlat, "İyi geceler" gibi geri alınması zor eylemler: onay ister.
 *  ZARARSIZ onaysız çalışır.
 *
 * Onay biçimi yüzeye göre değişir (soru-3): panel/palet ~0,8 sn BASILI TUT; tepsi menüsü onay penceresi;
 * kısayol, komut satırı, masaüstü karosu ve dış tetikler (1.4.0: Jump List, .lnk, yerel API, evpaneli://, PC olayı, toplantı ışığı)
 * yıkıcı eylem çalıştıramaz.
 *
 * 1.4.0: eylemSinifi(varlik, favori, servis) — servis verilirse src/lib/servis-izinleri.js'teki servis sınıfı da uygulanır:
 * 'yikici' servis (ör. todo.remove_item) her zaman onay ister (kapatılamaz); 'onayli' servis (ör. climate.set_hvac_mode)
 * favoride onay:false yoksa onay ister. Alan varsayılanı (onay isteyen alanlar) src/lib/alan-kaydi.js onayVarsayilan
 * sütunundan gelir: düğme, sanal düğme, script ve 1.4.0'da input_select, select, input_number, number, timer.
 * Servis sınıfı alan/varlık sınıfını yalnız SIKILAŞTIRIR (zararsızı onaylıya çevirir), hiçbir zaman gevşetmez.
 *
 * 1.4.0 cihaz grubu: servis VERİLMEZSE alanın tek tıklama servisi (alan-kaydi.js varsayilanServis) sınıflanır. Otomasyonun tek tıklama
 * eylemi "trigger" ve vananın aç/kapat servisleri "yikici"dir: favoride onay:false yazılsa bile (elle düzenlenmiş ayar dosyası dahil)
 * zorunlu onay kalır; panel/palet basılı tutma ister, kısayol, komut satırı ve masaüstü karosu reddeder.
 */

const { alanAl, guvenliVarlikMi } = require('./suzgec');
const { onayVarsayilanMi, varsayilanServis } = require('./alan-kaydi');
const { servisSinifi } = require('./servis-izinleri');
const { sadelestir } = require('./metin');
const { TR } = require('./ceviri-varsayilan');

const SINIF = Object.freeze({ ZARARSIZ: 'zararsiz', YIKICI: 'yikici', YASAK: 'yasak' });
// 'masaustu' (1.4.0, o-33): masaüstüne sabitlenen karo penceresi. Basılı tutma/onay penceresi sunmaz: YALNIZ zararsız eylem çalışır, yıkıcı olan reddedilir (kaynakIzni).
// 1.4.0 dış tetikler (dis grubu: o-21, o-47, o-52, o-53, o-54): uygulamanın penceresi DIŞINDAN gelen eylem kaynakları. Hepsi varsayılan kapalıdır ve
// src/lib/dis-tetik.js kapısından geçer; burada da YALNIZ zararsız eylem çalışır (kaynakIzni yıkıcıyı reddeder) ve disKaynakIzni ile valf, otomasyon,
// kamera, perde/kepenk ve klima modu değişimi hiçbir dış kaynaktan çalışmaz.
//   jumplist         görev çubuğu atlama listesi görevi (--eylem=<ad> --kaynak=jumplist)
//   kisayol-dosyasi  Ayarlar'da oluşturulan masaüstü kısayolu .lnk (--eylem=<ad> --kaynak=kisayol)
//   yerel-api        127.0.0.1 üzerindeki jetonlu yerel API (POST /eylem)
//   protokol         evpaneli://eylem?ad=<favori adı> bağlantısı
//   pc-olayi         PC kilitlendi / kilit açıldı / uyku / uyanış
//   toplanti         mikrofon ya da kamera kullanımı (toplantı ışığı)
const DIS_KAYNAKLAR = Object.freeze(['jumplist', 'kisayol-dosyasi', 'yerel-api', 'protokol', 'pc-olayi', 'toplanti']);
// 'gecikmeli' (1.4.0, o-15): "10 dk sonra kapat" gibi ertelenen eylem. Onay sunamaz: YALNIZ zararsız eylem çalışır; zamanı gelince hat kuralları yeniden uygulanır.
const KAYNAKLAR = Object.freeze(['tepsi-menu', 'panel', 'palet', 'kisayol', 'komut-satiri', 'masaustu', 'gecikmeli', ...DIS_KAYNAKLAR]);
// Dış kaynaklardan hiç çalışmayan alanlar (sınıfları zararsız sayılsa da): valf ve otomasyon (ne yaptıkları bilinmez / su ve gaz), kamera, perde ve
// kepenk (cover; dışarıdan görünürlük), Kapı Kuralı alanları ve yapılacaklar listesi. Alan kaydında olmayan alan zaten hiçbir yüzeye giremez.
const DIS_YASAK_ALANLAR = Object.freeze(['valve', 'automation', 'camera', 'cover', 'lock', 'alarm_control_panel', 'siren', 'todo']);
// Dış kaynaklardan çalışmayan servisler: klima modu değişimi (ısıt / soğut / kapalı; turn_on ve turn_off da modu değiştirir) ile fan modu ve ön ayar (away / eco gibi ön ayarlar çalışma biçimini değiştirir).
const DIS_YASAK_SERVISLER = Object.freeze({ climate: Object.freeze(['set_hvac_mode', 'set_fan_mode', 'set_preset_mode', 'turn_on', 'turn_off', 'toggle']) });

// 1.4.0 cihaz grubu: bu alanların HİÇBİR eylemi onaysız çalışmaz ve favoride onay kapatılamaz (vana: gaz/su ana vanası olabilir;
// otomasyon: ne yaptığı uygulamaca bilinemez). Dış tetikleyiciler ayrıca bu alanları kesin reddeder (aşağıdaki DIS_YASAK_ALANLAR / disKaynakIzni: tek kaynak).
const ZORUNLU_ONAYLI_ALANLAR = new Set(['valve', 'automation']);

// Açık liste: her zaman YIKICI ve onay KAPATILAMAZ (zorunlu).
const YIKICI_KIMLIKLER = new Set([
  'button.pc_bilgisayari_kapat',
  'button.pc_bilgisayari_yeniden_baslat',
  'button.pc_bilgisayari_uyut',
  'button.pc_powershell',
  'button.pc2_bilgisayari_kapat',
  'button.pc2_bilgisayari_yeniden_baslat',
  'button.homeassistant_restart',
  'button.homeassistant_reload',
  'script.pc_kapat',
  'script.iyi_geceler',
  'switch.oyun_bilgisayari',
  'switch.oyun_bilgisayari_akilli',
]);

// Açık liste: bilinen zararsız eylemler; ipucu belirteçlerini (ör. "ekran_kapat" -> "kapat") geçer.
const ZARARSIZ_KIMLIKLER = new Set([
  'button.pc_ekran_kapat',
  'button.pc_ekran_ac',
  'button.pc_mediaplaypause',
  'button.pc_medianext',
  'button.pc_mediaprevious',
  'button.pc_mediavolumeup',
  'button.pc_mediavolumedown',
  'button.pc_mediamute',
  'button.pc_ses_cikis_hoparlor',
  'button.pc_ses_cikis_kulaklik',
  'script.telefonu_bul',
]);

// İpucu belirteçleri yalnız bu alanlarda aranır (ışık, vantilatör ve sahne muaf). Sahnenin KENDİ adı bilerek taranmaz ("Işıkları kapat",
// "Hepsini kapat" masum sahnelerdir); sahnenin ne yaptığını üyeleri söyler ve üyeler ayrıca taranır (uyelerdenZorunluMu).
const IPUCU_ALANLARI = new Set(['button', 'input_button', 'script', 'switch', 'input_boolean']);
// Belirteç BAŞI eşleşir ("kapatma" ve "kapat"; ama "preset" "reset" sayılmaz). Sözcükler sadelestir sonrası biçimdedir (ü -> u, é -> e).
// Arayüz dilleri için (HA adları çoğu kez yerel dilde): DE herunterfahren / neustart / ruhezustand / zurücksetzen, FR redémarrer /
// réinitialiser, ES reiniciar / restablecer / suspender / hibernar. Genel kapatma fiilleri (apagar, éteindre, ausschalten) tek başına
// yoktur: ışık betiklerini gereksiz zorunlu onaya düşürürdü; bilgisayar sözcüğüyle çift olarak aşağıdadır. Liste yalnız genişler.
const IPUCU_BELIRTECLERI = [
  'kapat',
  'restart',
  'reboot',
  'shutdown',
  'poweroff',
  'uyut',
  'hibernate',
  'powershell',
  'sifirla',
  'reset',
  'hibern',
  'herunterfahr',
  'neustart',
  'ruhezustand',
  'zurucksetz',
  'redemarr',
  'reinitialis',
  'reinici',
  'restablec',
  'suspend',
];
// Ayrı yazılmış çiftler: ikisi de (belirteç başı olarak) bulunmalı.
const IPUCU_CIFTLERI = [
  ['yeniden', 'baslat'],
  ['power', 'off'],
  ['shut', 'down'],
  ['neu', 'start'],
  ['herunter', 'fahren'],
  ['eteindre', 'pc'],
  ['eteindre', 'ordinateur'],
  ['apagar', 'pc'],
  ['apagar', 'ordenador'],
  ['ausschalten', 'pc'],
  ['ausschalten', 'rechner'],
  ['ausschalten', 'computer'],
];

// Onay penceresi açıklamaları src/lib/ceviri/ana.js sözlüğündedir ('onay.<kimlik>'); burada yalnız hangi kimliklerin açıklaması olduğu durur.
const ACIKLAMALI_KIMLIKLER = new Set([
  'button.pc_bilgisayari_kapat',
  'button.pc_bilgisayari_yeniden_baslat',
  'button.pc_bilgisayari_uyut',
  'button.pc_powershell',
  'button.pc2_bilgisayari_kapat',
  'button.pc2_bilgisayari_yeniden_baslat',
  'button.homeassistant_restart',
  'button.homeassistant_reload',
  'script.pc_kapat',
  'script.iyi_geceler',
  'switch.oyun_bilgisayari',
  'switch.oyun_bilgisayari_akilli',
]);

function ipucuVarMi(kimlik, ad) {
  const belirtecler = `${sadelestir(kimlik)} ${sadelestir(ad)}`.split(/[^a-z0-9]+/).filter(Boolean);
  const basiVar = (onek) => belirtecler.some((b) => b.startsWith(onek));
  if (IPUCU_BELIRTECLERI.some(basiVar)) return true;
  return IPUCU_CIFTLERI.some(([a, b]) => basiVar(a) && basiVar(b));
}

/** Üye kimliği kendi başına zorunlu onaylı mı (vana/otomasyon alanı, açık yıkıcı liste, kendi alanında ipucu belirteci)? */
function uyeZorunluMu(uye) {
  const alan = alanAl(uye);
  if (ZORUNLU_ONAYLI_ALANLAR.has(alan) || YIKICI_KIMLIKLER.has(uye)) return true;
  return IPUCU_ALANLARI.has(alan) && !ZARARSIZ_KIMLIKLER.has(uye) && ipucuVarMi(uye, '');
}

/**
 * 1.6.0 sonrası (yalnız sıkılaştırma): sahne/grup üye listesi (attributes.entity_id). Sahne çalışınca üyeleri ayarlanır; zorunlu onaylı bir üyesi
 * (vana, otomasyon, PC kapat, "modem yeniden başlat" anahtarı...) olan sahne ya da grup da zorunlu onaylıdır: kısayol, komut satırı, masaüstü
 * karosu, ertelenen eylem ve dış tetikler onu çalıştıramaz, panel/palet basılı tutma ister. Kapı/kilit ve alan kaydında olmayan üyeyi süzgeç
 * (suzgec.js uyelerGuvenliMi) zaten eler; burada geçersiz biçim yalnız atlanır.
 */
function uyelerdenZorunluMu(nitelikler) {
  const uyeler = nitelikler.entity_id;
  const liste = typeof uyeler === 'string' ? [uyeler] : Array.isArray(uyeler) ? uyeler : [];
  return liste.some((uye) => typeof uye === 'string' && uyeZorunluMu(uye));
}

/**
 * @param {{entity_id:string, attributes?:object}} varlik HA durumu (ya da en az { entity_id, attributes.friendly_name })
 * @param {{onay?:boolean}} [favori] ayardaki favori kaydı
 * @param {string} [servis] 1.4.0: çağrılacak servis (verilmezse varlığın tek tıklama eylemi sınıflanır)
 * @returns {{ sinif: 'zararsiz'|'yikici'|'yasak', zorunlu: boolean, neden: string }}
 *   zorunlu: onay kapatılamaz (açık liste, ipucu belirteci, zorunlu onaylı sahne/grup üyesi ya da 'yikici' servis)
 */
function eylemSinifi(varlik, favori, servis) {
  const temel = varlikSinifi(varlik, favori);
  if (temel.sinif === SINIF.YASAK) return temel;
  const alan = alanAl(varlik.entity_id);
  const hedef = servis === undefined ? varsayilanServis(alan) : servis; // servis verilmezse tek tıklama servisi
  if (hedef === undefined || hedef === null) return temel;
  const s = servisSinifi(alan, hedef);
  if (s === 'yikici') return { sinif: SINIF.YIKICI, zorunlu: true, neden: 'servis' };
  const onay = favori && typeof favori === 'object' ? favori.onay : undefined;
  if (s === 'onayli' && temel.sinif === SINIF.ZARARSIZ && onay !== false) return { sinif: SINIF.YIKICI, zorunlu: false, neden: 'servis-varsayilani' };
  return temel;
}

function varlikSinifi(varlik, favori) {
  if (!guvenliVarlikMi(varlik)) return { sinif: SINIF.YASAK, zorunlu: true, neden: 'guvenlik' };
  const kimlik = varlik.entity_id;
  const alan = alanAl(kimlik);
  const nitelikler = varlik.attributes && typeof varlik.attributes === 'object' ? varlik.attributes : {};
  const ad = nitelikler.friendly_name ?? '';
  const onay = favori && typeof favori === 'object' ? favori.onay : undefined;
  if (ZORUNLU_ONAYLI_ALANLAR.has(alan)) return { sinif: SINIF.YIKICI, zorunlu: true, neden: 'alan-zorunlu' };
  if (YIKICI_KIMLIKLER.has(kimlik)) return { sinif: SINIF.YIKICI, zorunlu: true, neden: 'acik-liste' };
  if (uyelerdenZorunluMu(nitelikler)) return { sinif: SINIF.YIKICI, zorunlu: true, neden: 'uye' };
  if (ZARARSIZ_KIMLIKLER.has(kimlik)) {
    // Kullanıcı "Onay iste"yi açıkça işaretlediyse zararsız listedeki eylem de onay ister (ekstra güvenlik).
    return onay === true
      ? { sinif: SINIF.YIKICI, zorunlu: false, neden: 'favori-ayari' }
      : { sinif: SINIF.ZARARSIZ, zorunlu: false, neden: 'acik-liste' };
  }
  if (IPUCU_ALANLARI.has(alan) && ipucuVarMi(kimlik, ad)) return { sinif: SINIF.YIKICI, zorunlu: true, neden: 'ipucu' };
  if (onay === true) return { sinif: SINIF.YIKICI, zorunlu: false, neden: 'favori-ayari' };
  if (onayVarsayilanMi(alan)) {
    // Yeni eklenen düğme, script ve (1.4.0) seçici/sayı/zamanlayıcı favorileri varsayılan onaylıdır; kullanıcı açıkça kapatabilir (onay:false).
    return onay === false
      ? { sinif: SINIF.ZARARSIZ, zorunlu: false, neden: 'favori-ayari' }
      : { sinif: SINIF.YIKICI, zorunlu: false, neden: 'varsayilan' };
  }
  return { sinif: SINIF.ZARARSIZ, zorunlu: false, neden: 'alan-varsayilani' };
}

/**
 * Bir sınıfın bir yüzeyden çalıştırılıp çalıştırılamayacağı ve hangi onayın gerektiği.
 * @returns {{ izin: boolean, onayTuru: 'diyalog'|'basili'|null }}
 */
function kaynakIzni(sinif, kaynak) {
  if (!KAYNAKLAR.includes(kaynak)) return { izin: false, onayTuru: null };
  if (sinif === SINIF.ZARARSIZ) return { izin: true, onayTuru: null };
  if (sinif === SINIF.YIKICI) {
    if (kaynak === 'tepsi-menu') return { izin: true, onayTuru: 'diyalog' };
    if (kaynak === 'panel' || kaynak === 'palet') return { izin: true, onayTuru: 'basili' };
    return { izin: false, onayTuru: null }; // kısayol, komut satırı, masaüstü karosu, dış tetikler
  }
  return { izin: false, onayTuru: null }; // YASAK ve bilinmeyen sınıf
}

/**
 * 1.4.0 dış tetikler: alan ve servis bir dış kaynaktan (DIS_KAYNAKLAR) çalıştırılabilir mi? Yalnız SIKILAŞTIRIR: sınıf denetimi (kaynakIzni)
 * ayrıca uygulanır. servis verilmezse alanın tek tıklama eylemi kastedilir.
 * @param {string} alan
 * @param {string} [servis]
 */
function disKaynakIzni(alan, servis) {
  if (typeof alan !== 'string' || alan === '' || DIS_YASAK_ALANLAR.includes(alan)) return false;
  const yasak = Object.hasOwn(DIS_YASAK_SERVISLER, alan) ? DIS_YASAK_SERVISLER[alan] : null;
  return !(yasak && typeof servis === 'string' && yasak.includes(servis));
}

// Panele ve favorilere alınmayacak öneriler (detay-20): HA'yı yeniden başlat/yeniden yükle, "Onarımlar"ı yoksay, Google
// eşitleme, bulut anahtarları, PowerShell, yedek PC kapat/yeniden başlat ve geçici "önceki durum" sahneleri. Ayarlarda aday
// listesinde varsayılan GİZLİDİR (kullanıcı "Gizlenenleri göster" ile görür); gizlemek güvenlik kuralı DEĞİLDİR, süzgecin yerini tutmaz.
const GIZLI_KIMLIKLER = new Set([
  'button.homeassistant_restart',
  'button.homeassistant_reload',
  'button.ignore_all_issues',
  'button.unignore_all_issues',
  'button.google_assistant_cihazlari_senkronize_edin',
  'switch.cloud_alexa',
  'switch.cloud_alexa_report_state',
  'switch.cloud_google',
  'switch.cloud_google_report_state',
  'switch.cloud_remote',
  'button.pc_powershell',
  'button.pc2_bilgisayari_kapat',
  'button.pc2_bilgisayari_yeniden_baslat',
]);
const GIZLI_DESENLER = [/^button.homeassistant_/, /^switch.cloud_/, /^button.google_assistant_/, /powershell/, /satellite/, /onceki_durum|previous_state/];

/**
 * Ayarlardaki aday listesinde varsayılan gizli mi? Yalnız kimliğe bakılır. Süzgeçten (guvenliVarlikMi) geçmeyen
 * varlıklar zaten listede hiç yoktur; kapı hiçbir sayaca girmez.
 * @param {{entity_id?:string}} varlik
 */
function adayGizliMi(varlik) {
  const kimlik = typeof varlik?.entity_id === 'string' ? varlik.entity_id : '';
  if (kimlik === '') return false;
  return GIZLI_KIMLIKLER.has(kimlik) || GIZLI_DESENLER.some((d) => d.test(kimlik));
}

/** Onay penceresinde gösterilen kısa açıklama (t: çevirmen; verilmezse Türkçe). */
function onayAciklamasi(kimlik, t = TR) {
  return t(ACIKLAMALI_KIMLIKLER.has(kimlik) ? `onay.${kimlik}` : 'onay.genel');
}

module.exports = {
  SINIF,
  KAYNAKLAR,
  DIS_KAYNAKLAR,
  DIS_YASAK_ALANLAR,
  DIS_YASAK_SERVISLER,
  disKaynakIzni,
  YIKICI_KIMLIKLER,
  ZORUNLU_ONAYLI_ALANLAR,
  ZARARSIZ_KIMLIKLER,
  IPUCU_BELIRTECLERI,
  GIZLI_KIMLIKLER,
  adayGizliMi,
  eylemSinifi,
  kaynakIzni,
  onayAciklamasi,
};
