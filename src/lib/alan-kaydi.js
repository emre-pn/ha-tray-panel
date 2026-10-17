'use strict';

/**
 * Alan (domain) kaydı — 1.4.0 ortak güvenli altyapı (saf; hiçbir modüle bağlı değildir, döngüsel bağımlılık olmasın diye
 * suzgec.js bunu kullanır, bu dosya hiçbir şey require etmez).
 *
 * Uygulamanın tanıdığı TÜM alanlar tek tabloda: hangisi panelde karo/favori olabilir, hangisi yalnız okunur gösterilir,
 * tek tıklamada (tepsi menüsü, kısayol, komut satırı) hangi servis çağrılır, karo modelinde hangi öznitelik alt kümesini taşır.
 * Bu tabloda OLMAYAN alan hiçbir yüzeye giremez (süzgeç `kayitliAlanMi` ile reddeder). Kapı Kuralı alanları (lock,
 * alarm_control_panel, siren), kamera (camera: ayrı, kullanıcı onaylı izin listesi; src/lib/kamera.js) ve bilerek dışarıda
 * bırakılanlar (lawn_mower...) tabloya EKLENMEZ: test/alan-kaydi.test.js bunu sınar.
 *
 * 1.4.0 cihaz grubu (sınırda alanlar, kullanıcı kararıyla; hepsi süzgeçte EK koşullarla):
 *   cover       YALNIZ device_class curtain, blind, shade, awning (süzgeç suzgec.js PERDE_SINIFLARI; sınıfı boş/bilinmeyen, garage, gate, door,
 *               shutter, window, damper dışarıda) ve ad süzgeci. Servisler zararsızdır; kart panelde kendi denetimini çizer.
 *   valve       açma ve kapama servisleri "yıkıcı" (basılı tut onayı kapatılamaz); dış tetikleyicilerden ASLA çalışmaz.
 *   automation  tetikle / aç / kapat servisleri "yıkıcı"; dış tetikleyicilerden ASLA çalışmaz.
 *
 * Alan kaydı (her satır):
 *   tur               'eylem'  : servis çağrılabilir (izinli servisler src/lib/servis-izinleri.js'te)
 *                     'okunur' : HİÇBİR servis çağrılmaz (sensor, binary_sensor, weather, calendar)
 *   karo              true: ayarlarda favori seçilebilir ve panelde karo olur; false: yalnız kendi özelliğinin ayarıyla
 *                     (ör. yapılacaklar listesi, takvim) kullanılır, favori listesine giremez
 *   varsayilanServis  tek tıklama servisi (tepsi menüsü, eylem kısayolu, komut satırı, panelde düz tıklama). null: tek tıklama
 *                     eylemi YOK; karo kendi denetimini çizer (iklim, medya...). Tepsi menüsü ve komut satırı bu karoları atlar.
 *   model             src/lib/varlik-ozellik.js'teki öznitelik alt kümesi anahtarı (renderer'a giden güvenli alanlar)
 *   onayVarsayilan    true: YENİ favoride eylemler varsayılan olarak onay ister (basılı tut / onay penceresi); kullanıcı
 *                     favori ayarından (onay:false) kapatabilir. Zorunlu onay (kapatılamaz) eylem-sinifi.js ve servis
 *                     şemasındaki sinif:'yikici' ile belirlenir.
 *
 * Yeni alan eklemek (ajanlar için kalıp): 1) bu tabloya satır, 2) okunur değilse servis-izinleri.js'e izinli servisler ve
 * parametre şemaları, 3) varlik-ozellik.js'e model, 4) src/lib/ceviri/ana.js'e 'alan.<alan>' etiketi (tr + en),
 * 5) test/alan-kaydi.test.js'te beklenen liste. Kapı Kuralı alanı ya da cover/camera eklenemez (test reddeder).
 */

const ALAN_KAYDI = Object.freeze({
  // 1.3.0'dan gelen favori alanları (sıra ayarlardaki aday listesinin sırasıdır)
  light: Object.freeze({ tur: 'eylem', karo: true, varsayilanServis: 'toggle', model: 'isik', onayVarsayilan: false }),
  switch: Object.freeze({ tur: 'eylem', karo: true, varsayilanServis: 'toggle', model: 'acKapa', onayVarsayilan: false }),
  fan: Object.freeze({ tur: 'eylem', karo: true, varsayilanServis: 'toggle', model: 'fan', onayVarsayilan: false }),
  input_boolean: Object.freeze({ tur: 'eylem', karo: true, varsayilanServis: 'toggle', model: 'acKapa', onayVarsayilan: false }),
  scene: Object.freeze({ tur: 'eylem', karo: true, varsayilanServis: 'turn_on', model: 'tetik', onayVarsayilan: false }),
  script: Object.freeze({ tur: 'eylem', karo: true, varsayilanServis: 'turn_on', model: 'tetik', onayVarsayilan: true }),
  button: Object.freeze({ tur: 'eylem', karo: true, varsayilanServis: 'press', model: 'tetik', onayVarsayilan: true }),
  input_button: Object.freeze({ tur: 'eylem', karo: true, varsayilanServis: 'press', model: 'tetik', onayVarsayilan: true }),
  // 1.4.0 eylem alanları
  climate: Object.freeze({ tur: 'eylem', karo: true, varsayilanServis: null, model: 'iklim', onayVarsayilan: false }),
  media_player: Object.freeze({ tur: 'eylem', karo: true, varsayilanServis: null, model: 'medya', onayVarsayilan: false }),
  humidifier: Object.freeze({ tur: 'eylem', karo: true, varsayilanServis: 'toggle', model: 'nem', onayVarsayilan: false }),
  vacuum: Object.freeze({ tur: 'eylem', karo: true, varsayilanServis: null, model: 'supurge', onayVarsayilan: false }),
  input_select: Object.freeze({ tur: 'eylem', karo: true, varsayilanServis: null, model: 'secim', onayVarsayilan: true }),
  select: Object.freeze({ tur: 'eylem', karo: true, varsayilanServis: null, model: 'secim', onayVarsayilan: true }),
  input_number: Object.freeze({ tur: 'eylem', karo: true, varsayilanServis: null, model: 'sayi', onayVarsayilan: true }),
  number: Object.freeze({ tur: 'eylem', karo: true, varsayilanServis: null, model: 'sayi', onayVarsayilan: true }),
  timer: Object.freeze({ tur: 'eylem', karo: true, varsayilanServis: null, model: 'zamanlayici', onayVarsayilan: true }),
  todo: Object.freeze({ tur: 'eylem', karo: false, varsayilanServis: null, model: 'yapilacak', onayVarsayilan: false }),
  // 1.4.0 cihaz grubu: perde/jaluzi (cover; yalnız izinli cihaz sınıfları, süzgeçte), vana (valve) ve otomasyon (automation).
  // Perdenin tek tıklama eylemi YOKTUR (aç/kapat/dur/konum kartta ayrı düğmelerdir); otomasyonun tek tıklama eylemi "tetikle"dir ve
  // yıkıcıdır (basılı tut); vananın yoktur (aç ve kapat ayrı ayrı basılı tutulur).
  cover: Object.freeze({ tur: 'eylem', karo: true, varsayilanServis: null, model: 'perde', onayVarsayilan: false }),
  valve: Object.freeze({ tur: 'eylem', karo: true, varsayilanServis: null, model: 'vana', onayVarsayilan: true }),
  automation: Object.freeze({ tur: 'eylem', karo: true, varsayilanServis: 'trigger', model: 'otomasyon', onayVarsayilan: true }),
  // 1.4.0 yalnız okunur alanlar: hiçbir servis çağrılmaz
  sensor: Object.freeze({ tur: 'okunur', karo: true, varsayilanServis: null, model: 'sensor', onayVarsayilan: false }),
  binary_sensor: Object.freeze({ tur: 'okunur', karo: true, varsayilanServis: null, model: 'ikiliSensor', onayVarsayilan: false }),
  weather: Object.freeze({ tur: 'okunur', karo: true, varsayilanServis: null, model: 'hava', onayVarsayilan: false }),
  calendar: Object.freeze({ tur: 'okunur', karo: false, varsayilanServis: null, model: 'takvim', onayVarsayilan: false }),
});

/** Kayıttaki alanlar, tablo sırasında (ayarlardaki aday listesi bu sırayla dizilir). */
const KAYITLI_ALANLAR = Object.freeze(Object.keys(ALAN_KAYDI));
/** 1.4.0'da eklenen alanlar (1.3.0 favori alanları dışındakiler). */
const YENI_ALANLAR = Object.freeze(KAYITLI_ALANLAR.slice(KAYITLI_ALANLAR.indexOf('climate')));
/** Karo/favori olabilen alanlar, tablo sırasında. */
const KARO_ALAN_SIRASI = Object.freeze(KAYITLI_ALANLAR.filter((a) => ALAN_KAYDI[a].karo));

/** @returns {object|null} alanın kaydı (dondurulmuş) ya da null */
function alanBilgisi(alan) {
  return typeof alan === 'string' && Object.hasOwn(ALAN_KAYDI, alan) ? ALAN_KAYDI[alan] : null;
}
/** Alan tabloda mı (herhangi bir yüzeyde görünebilir mi)? Kapı Kuralı ayrıca süzgeçte uygulanır. */
const kayitliAlanMi = (alan) => alanBilgisi(alan) !== null;
/** Ayarlarda favori seçilebilir ve panelde karo olabilir mi? */
const karoAlaniMi = (alan) => alanBilgisi(alan)?.karo === true;
/** Bu alanda servis çağrılabilir mi (izinli servisler ayrıca servis-izinleri.js'te)? */
const eylemAlaniMi = (alan) => alanBilgisi(alan)?.tur === 'eylem';
/** Yalnız okunur alan mı (hiçbir servis çağrılmaz)? */
const okunurAlanMi = (alan) => alanBilgisi(alan)?.tur === 'okunur';
/** Tek tıklama servisi; yoksa null. */
const varsayilanServis = (alan) => alanBilgisi(alan)?.varsayilanServis ?? null;
/** Karo modelinin öznitelik alt kümesi anahtarı; yoksa null. */
const alanModeli = (alan) => alanBilgisi(alan)?.model ?? null;
/** Yeni favoride eylemler varsayılan olarak onay ister mi? */
const onayVarsayilanMi = (alan) => alanBilgisi(alan)?.onayVarsayilan === true;
// Dış tetikleyicilerin (Jump List, masaüstü kısayolu, yerel API, evpaneli://, PC olayları, toplantı ışığı) alan / servis yasağının TEK kaynağı
// src/lib/eylem-sinifi.js disKaynakIzni'dir (DIS_YASAK_ALANLAR, DIS_YASAK_SERVISLER); burada ikinci bir liste tutulmaz.

/** Aday listesinde sıralama için: tablodaki yer (bilinmeyen alan en sona). */
function alanSirasi(alan) {
  const i = KAYITLI_ALANLAR.indexOf(alan);
  return i < 0 ? KAYITLI_ALANLAR.length : i;
}

module.exports = {
  ALAN_KAYDI,
  KAYITLI_ALANLAR,
  YENI_ALANLAR,
  KARO_ALAN_SIRASI,
  alanBilgisi,
  kayitliAlanMi,
  karoAlaniMi,
  eylemAlaniMi,
  okunurAlanMi,
  varsayilanServis,
  alanModeli,
  onayVarsayilanMi,
  alanSirasi,
};
