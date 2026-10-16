'use strict';

/**
 * Daha eski bir sürümün bıraktığı yedekten, geçerken kaybolan bilgilerin geri alınması (saf; dosya sistemi ve günlük dışarıdan verilir,
 * Electron'a bağlı değildir).
 *
 * Sorun. Şeması bu sürümle aynı (6) olan ayarlar.json'u, AYNI klasörü kullanan daha eski bir sürüm (1.3.0, 1.2.0; taşınabilir derleme
 * kurulu sürümle aynı %APPDATA% klasörünü paylaşır) açarsa dosyayı "daha yeni şema" diye ayarlar.v6-yedek.json olarak yedekler ve kendi
 * biçimiyle ÜZERİNE yazar. Eski sürümün tanımadığı bilgiler düşer: tek tıklamalı olmayan favoriler (iklim, medya, sensör, seçici...),
 * kalan favorilerin simge/renk/boyut/tepsi/kısayol eylemi alanları ve Almanca/Fransızca/İspanyolca dil seçimi ('sistem'e döner). Bu sürüme
 * dönüşte bunlar kendiliğinden geri gelmez; üstelik eski sürüm var olan yedeği ezmez (COPYFILE_EXCL), yani ikinci gidiş dönüşte yeni
 * durum hiç yedeklenmez. Eski sürüm değiştirilemez; bu modül bu sürüm tarafında iki şeyi yapar:
 *  1) Açılışta ayarlar.v<şema>-yedek.json varsa içinde olup şimdi eksik olan bilgileri geri alır (eskiSurumKaybiniTamamla): yalnız eski
 *     sürümün KENDİLİĞİNDEN düşüreceği şeyler. Eski sürümün tanıdığı alandaki (light, switch, fan, input_boolean, scene, script, button,
 *     input_button) bir favori yedekte var, şimdi yok ise kullanıcı onu eski sürümde bilerek silmiş olabilir: GERİ ALINMAZ.
 *  2) Yedeği "tüketir" (eskiSurumYedeginiKenaraAl): ayarlar.v6-yedek.json, ayarlar.v6-yedek-<zaman>.json olarak yeniden adlandırılır. Böylece
 *     eski sürüm bir sonraki gidişte ayarlar.v6-yedek.json adını boş bulur ve o günkü durumu yeniden yedekler. Hiçbir yedek silinmez
 *     (en yeni EN_COK_ZAMANLI_YEDEK tanesi tutulur); "Yedekten geri dön" listesinde görünür.
 * Geri alınan favoriler normal yüklemeden geçer (favorileriDuzelt: Kapı Kuralı, alan kaydı, sınırlar); yedekteki kısayol başka bir
 * kısayolla çakışıyorsa ya da kısayollu favori sınırı doluysa atılır, çakışan kısayol kullanıcının mevcut kısayolunu ele geçirmez.
 */

const path = require('node:path');
const { SEMA_SURUMU, ayarlariDuzelt, oncekiSemaSurumu } = require('./ayar-sema');
const { FAVORI_ALANLARI, alanAl } = require('./suzgec');
const { favorileriDuzelt, EN_COK_FAVORI, EN_COK_KISAYOLLU_FAVORI } = require('./favoriler');
const { kisayolNormallestir } = require('./kisayol');
const { yedekDosyaAdi, jsonDosyasiniOku, zamanliYedekleriBud, hataKodu, gunlugeYaz } = require('./ayar-yedegi');

// Eski sürümün favori kaydında bulunmayan, bu sürümün eklediği alanlar: eski sürüm kalan favorilerden de bunları siler.
const YENI_FAVORI_ALANLARI = Object.freeze(['simge', 'renk', 'boyut', 'tepsi', 'kisayolEylemi']);
// Eski sürümün tanıdığı dil ayarları: bunların dışındaki bir değer ('de', 'fr', 'es') eski sürümde 'sistem'e dönerdi.
const ESKI_SURUM_DILLERI = new Set(['sistem', 'tr', 'en']);

/**
 * Yedek dosyasını okur: ayarlar.v<şema>-yedek.json (bu sürümün şemasında bir ayar dosyası olmalı). Yoksa, okunamıyorsa, çok büyükse ya da
 * bu şemanın dosyası değilse null. Hata fırlatmaz.
 * @returns {{ ad: string, ham: object }|null}
 */
function eskiSurumYedeginiOku({ dizin, fs = require('node:fs') } = {}) {
  const ad = yedekDosyaAdi(SEMA_SURUMU);
  const okunan = jsonDosyasiniOku(path.join(dizin, ad), fs);
  if (!okunan.ok) return null;
  const ham = okunan.ham;
  if (!ham || typeof ham !== 'object' || Array.isArray(ham) || ham.semaSurumu !== SEMA_SURUMU) return null;
  return { ad, ham };
}

const kisayolAnahtari = (k) => {
  try {
    return typeof k === 'string' && k.trim() !== '' ? kisayolNormallestir(k) : null;
  } catch {
    return null;
  }
};

/**
 * Yedekte olup şimdi eksik olan, eski sürümün KENDİLİĞİNDEN düşürdüğü bilgileri şimdiki ayarlara ekler (saf; girdiyi değiştirmez).
 * @param {object} ayarlar yüklenmiş (düzeltilmiş) şimdiki ayarlar
 * @param {object} yedekHam yedek dosyasının içeriği (ayarlar.json biçimi)
 * @param {{ varsayilan?: object }} [secenek] varsayilan-ayarlar.json içeriği
 * @returns {{ ayarlar: object, geriAlinanFavoriler: string[], doldurulanFavoriler: string[], dilGeriAlindi: boolean, degisti: boolean }}
 */
function eskiSurumKaybiniTamamla(ayarlar, yedekHam, { varsayilan = {} } = {}) {
  const yedek = ayarlariDuzelt(yedekHam, { varsayilan }).ayarlar; // kapı kuralı ve alan kaydı yedekteki favorilere de uygulanır
  const eskiAlanlar = new Set(Object.keys(FAVORI_ALANLARI));
  const mevcut = Array.isArray(ayarlar.favoriler) ? ayarlar.favoriler : [];
  const liste = mevcut.map((f) => ({ ...f }));
  const oncekiHali = new Map(mevcut.map((f) => [f.entity_id, f]));

  // Kısayol çakışması: yedekteki favorinin kısayolu mevcut bir kısayolu ele geçirmesin.
  const kullanilan = new Set(
    [ayarlar.kisayol, ayarlar.paletKisayol, ...(Array.isArray(ayarlar.panolar) ? ayarlar.panolar.map((p) => p?.kisayol) : []), ...liste.map((f) => f.kisayol)]
      .map(kisayolAnahtari)
      .filter(Boolean),
  );
  let kisayolluSayisi = liste.filter((f) => typeof f.kisayol === 'string' && f.kisayol !== '').length;
  let kalanYer = EN_COK_FAVORI - liste.length; // üst sınırı aşan geri alma, var olan favorileri DEĞİL, geri alınacakları dışarıda bırakır

  const geriAlinacaklar = new Set();
  const doldurulacaklar = new Set();
  let sonMevcut = null; // yedek sırasında listede bulunan son favori: geri alınan favori onun hemen arkasına konur (özgün sıra)
  for (const y of Array.isArray(yedek.favoriler) ? yedek.favoriler : []) {
    const mevcutOge = liste.find((f) => f.entity_id === y.entity_id);
    if (mevcutOge) {
      for (const alan of YENI_FAVORI_ALANLARI) {
        if (mevcutOge[alan] === undefined && y[alan] !== undefined) {
          mevcutOge[alan] = y[alan];
          doldurulacaklar.add(y.entity_id);
        }
      }
      sonMevcut = y.entity_id;
      continue;
    }
    if (eskiAlanlar.has(alanAl(y.entity_id))) continue; // eski sürümün tanıdığı alan: yoksa kullanıcı bilerek silmiştir
    if (kalanYer <= 0) continue;
    const geri = { ...y };
    const anahtar = kisayolAnahtari(geri.kisayol);
    if (anahtar !== null && (kullanilan.has(anahtar) || kisayolluSayisi >= EN_COK_KISAYOLLU_FAVORI)) {
      delete geri.kisayol;
      delete geri.kisayolEylemi;
    } else if (anahtar !== null) {
      kullanilan.add(anahtar);
      kisayolluSayisi += 1;
    }
    const konum = sonMevcut === null ? 0 : liste.findIndex((f) => f.entity_id === sonMevcut) + 1;
    liste.splice(konum, 0, geri);
    kalanYer -= 1;
    geriAlinacaklar.add(y.entity_id);
    sonMevcut = y.entity_id;
  }

  // Yeniden doğrulama: üst sınır, tekrar, kapı kuralı. Doğrulamadan geçemeyen geri alınmış sayılmaz.
  const { favoriler } = favorileriDuzelt(liste);
  const sonKimlikler = new Set(favoriler.map((f) => f.entity_id));
  const geriAlinanFavoriler = [...geriAlinacaklar].filter((k) => sonKimlikler.has(k));
  const doldurulanFavoriler = [...doldurulacaklar].filter((k) => {
    const once = oncekiHali.get(k);
    const sonra = favoriler.find((f) => f.entity_id === k);
    return once && sonra && YENI_FAVORI_ALANLARI.some((alan) => once[alan] === undefined && sonra[alan] !== undefined);
  });

  const dilGeriAlindi = ayarlar.dil === 'sistem' && typeof yedek.dil === 'string' && !ESKI_SURUM_DILLERI.has(yedek.dil);
  const degisti = geriAlinanFavoriler.length > 0 || doldurulanFavoriler.length > 0 || dilGeriAlindi;
  if (!degisti) return { ayarlar, geriAlinanFavoriler, doldurulanFavoriler, dilGeriAlindi, degisti };

  const sonuc = { ...ayarlar, favoriler: geriAlinanFavoriler.length > 0 || doldurulanFavoriler.length > 0 ? favoriler : ayarlar.favoriler };
  if (dilGeriAlindi) sonuc.dil = yedek.dil;
  if (geriAlinanFavoriler.length > 0 && Array.isArray(ayarlar.engellenenFavoriler)) {
    // Eski sürümün "alan" nedeniyle düşürdüğü kayıtlar artık engelli değil
    sonuc.engellenenFavoriler = ayarlar.engellenenFavoriler.filter((e) => !geriAlinanFavoriler.includes(e?.entity_id));
  }
  return { ayarlar: sonuc, geriAlinanFavoriler, doldurulanFavoriler, dilGeriAlindi, degisti };
}

/**
 * Yedek tüketilir: ayarlar.v<şema>-yedek.json -> ayarlar.v<şema>-yedek-<zaman>.json (eski sürümün bir sonraki gidişte yeniden yedek
 * alabilmesi için); en yeni EN_COK_ZAMANLI_YEDEK zaman damgalı yedek tutulur. Hata fırlatmaz; günlüğe yalnız hata kodu yazılır.
 * @returns {string|null} yeni dosya adı; yeniden adlandırılamadıysa null (yedek yerinde kalır, bir sonraki açılışta yeniden denenir)
 */
function eskiSurumYedeginiKenaraAl({ dizin, fs = require('node:fs'), simdi = Date.now(), gunluk = () => {} } = {}) {
  const ad = yedekDosyaAdi(SEMA_SURUMU, simdi);
  try {
    fs.renameSync(path.join(dizin, yedekDosyaAdi(SEMA_SURUMU)), path.join(dizin, ad));
  } catch (hata) {
    gunlugeYaz(gunluk, `Eski sürüm yedeği kenara alınamadı (${hataKodu(hata)}); açılış yine de sürüyor.`);
    return null;
  }
  zamanliYedekleriBud({ dizin, surum: SEMA_SURUMU, fs, koruAdlar: [ad] });
  return ad;
}

/**
 * ayarlariYukle'nin tek çağırdığı adım. Yedek yoksa ya da yüklenen dosya bu şemadan eskiyse (göç sürüyor) hiçbir şey yapılmaz.
 * @param {{ dizin: string, ayarlar: object, ham: unknown, varsayilan?: object, fs?: object, gunluk?: Function, simdi?: () => number }} girdi
 *   ham: ayarlar.json'dan okunan içerik (dosya yoksa ya da bozuksa null: o durumda yedekten ayar üretilmez)
 * @returns {{ ayarlar: object, geriAlindi: boolean, yedek: string|null, tuket: () => string|null }}
 *   tuket: ayarlar KAYDEDİLDİKTEN sonra çağrılır; yedeği kenara alır ve yeni adını döner (yedek yoksa null)
 */
function eskiSurumYedeginiDevral({ dizin, ayarlar, ham, varsayilan = {}, fs = require('node:fs'), gunluk = () => {}, simdi = Date.now } = {}) {
  const yok = { ayarlar, geriAlindi: false, yedek: null, tuket: () => null };
  if (!ham || typeof ham !== 'object' || Array.isArray(ham) || oncekiSemaSurumu(ham) < SEMA_SURUMU) return yok;
  const yedek = eskiSurumYedeginiOku({ dizin, fs });
  if (yedek === null) return yok;
  let sonuc;
  try {
    sonuc = eskiSurumKaybiniTamamla(ayarlar, yedek.ham, { varsayilan });
  } catch {
    gunlugeYaz(gunluk, 'Eski sürüm yedeği işlenemedi; açılış yine de sürüyor.');
    return { ...yok, yedek: yedek.ad };
  }
  if (sonuc.degisti) {
    gunlugeYaz(
      gunluk,
      `Eski sürümün bıraktığı yedekten geri alındı: ${sonuc.geriAlinanFavoriler.length} favori, ${sonuc.doldurulanFavoriler.length} favorinin görünüm alanları${sonuc.dilGeriAlindi ? ', dil seçimi' : ''}.`,
    );
  }
  return {
    ayarlar: sonuc.ayarlar,
    geriAlindi: sonuc.degisti,
    yedek: yedek.ad,
    tuket: () => eskiSurumYedeginiKenaraAl({ dizin, fs, simdi: simdi(), gunluk }),
  };
}

module.exports = {
  YENI_FAVORI_ALANLARI,
  eskiSurumYedeginiOku,
  eskiSurumKaybiniTamamla,
  eskiSurumYedeginiKenaraAl,
  eskiSurumYedeginiDevral,
};
