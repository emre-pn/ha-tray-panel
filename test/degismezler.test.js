'use strict';

/**
 * DEĞİŞMEZLER: kapı/kilit/alarm/garaj/bariyer/gate/lock varlıkları hiçbir favoriye, listeye, yüzeye ya da eyleme giremez
 * ve kapı HİÇBİR ZAMAN kendiliğinden açılmaz. Bu dosya tek tek kuralları değil, kuralların BİRLİKTE yüzeyler boyunca
 * tutulduğunu sınar; biri gevşetilirse burada kırılır. (Hiçbir şey çalıştırılmaz; saf modüller ve kaynak metni okunur.)
 *
 * Örnek envanter: test/veri/envanter.json (gerçekçi bir kurulumu örnekleyen 51 varlığın kimlik ve adı; durumlar kişisel zaman damgası içermesin diye 'unknown'a sadeleştirildi).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { FAVORI_ALANLARI, YASAK_ALANLAR, YASAK_KELIMELER, adGuvenliMi, guvenliVarlikMi, sadelestir } = require('../src/lib/suzgec');
const { SINIF, KAYNAKLAR, YIKICI_KIMLIKLER, ZARARSIZ_KIMLIKLER, eylemSinifi, kaynakIzni } = require('../src/lib/eylem-sinifi');
const { favorileriDuzelt, favorileriBirlestir } = require('../src/lib/favoriler');
const { ayarlariDuzelt } = require('../src/lib/ayar-sema');

const KOK = path.join(__dirname, '..');
const oku = (g) => fs.readFileSync(path.join(KOK, g), 'utf8');
const ENVANTER = JSON.parse(oku('test/veri/envanter.json')).map((v) => ({
  entity_id: v.entity_id,
  state: v.state,
  attributes: { friendly_name: v.friendly_name },
}));

// Sınama kehaneti (kuraldan BAĞIMSIZ yazılmış): kimlikte ya da adda bu kökler geçiyorsa varlık engelli olmalıdır.
// indoor/outdoor tam belirteçleri tek bilinçli istisnadır (hata-11).
const KAPI_KOKLERI = /kap[ıi]|door|kilit|kilid|lock|alarm|garaj|garage|bariyer|gate/i;
const ISTISNA = /\b(in|out)doors?\b/i;
const kapiMi = (v) => {
  const metin = `${v.entity_id} ${v.attributes.friendly_name ?? ''}`.normalize('NFKD').replace(/[\p{M}\p{Cf}]/gu, '');
  if (!KAPI_KOKLERI.test(metin)) return false;
  return !ISTISNA.test(metin.replace(/_/g, ' '));
};

test('örnek envanterde kapı/kilit/alarm içeren her varlık süzgeçten, sınıflamadan ve TÜM yüzeylerden dışlanır', () => {
  const kapilar = ENVANTER.filter(kapiMi);
  assert.ok(kapilar.length >= 5, 'envanterde kapı varlıkları bulunmalı (test boş geçmesin)');
  for (const varlik of kapilar) {
    const ad = `${varlik.entity_id} (${varlik.attributes.friendly_name})`;
    assert.equal(guvenliVarlikMi(varlik), false, `${ad}: süzgeçten geçmemeli`);
    for (const favori of [undefined, {}, { onay: true }, { onay: false }]) {
      const sinif = eylemSinifi(varlik, favori);
      assert.equal(sinif.sinif, SINIF.YASAK, `${ad}: sınıf YASAK olmalı`);
      for (const kaynak of KAYNAKLAR) {
        assert.equal(kaynakIzni(sinif.sinif, kaynak).izin, false, `${ad}: ${kaynak} yüzeyinden çalışmamalı`);
      }
    }
  }
});

test('yazım kandırmacaları: her yasak sözcük harf biçimi, görünmez karakter, bitişik yazım ve Türkçe ekle de engellenir (kimlik zararsız olsa bile)', () => {
  const sozcukler = ['Kapı', 'Garaj', 'Kilit', 'Kilidi', 'Alarm', 'Bariyer', 'Gate', 'Lock', 'Door', 'Garage'];
  const tamGenislik = (k) => [...k].map((c) => (/[a-z]/i.test(c) ? String.fromCodePoint(c.charCodeAt(0) + 0xfee0) : c)).join('');
  const matematikKalin = (k) => [...k.toUpperCase()].map((c) => (/[A-Z]/.test(c) ? String.fromCodePoint(0x1d400 + c.charCodeAt(0) - 65) : c)).join('');
  const kareHarf = (k) => [...k.toUpperCase()].map((c) => (/[A-Z]/.test(c) ? String.fromCodePoint(0x1f130 + c.charCodeAt(0) - 65) : c)).join('');
  const donusumler = {
    duz: (k) => k,
    buyuk: (k) => k.toLocaleUpperCase('tr-TR'),
    kucuk: (k) => k.toLocaleLowerCase('tr-TR'),
    tamGenislik,
    matematikKalin,
    kareHarf,
    yumusakTire: (k) => `${k.slice(0, 2)}\u00AD${k.slice(2)}`,
    sifirGenislik: (k) => `${k.slice(0, 2)}\u200B${k.slice(2)}`,
    kelimeBirlestirici: (k) => `${k.slice(0, 2)}\u2060${k.slice(2)}`,
    bitisikOnde: (k) => `Main${k}`,
    bitisikSonda: (k) => `Smart${k}Opener`,
    ayracli: (k) => `salon_${k}_rolesi`,
  };
  for (const sozcuk of sozcukler) {
    for (const [donusum, uygula] of Object.entries(donusumler)) {
      const ad = uygula(sozcuk);
      const varlik = { entity_id: 'button.bina_ac', attributes: { friendly_name: ad } }; // kimlik kapıyı belli etmiyor
      assert.equal(guvenliVarlikMi(varlik), false, `${sozcuk} (${donusum}): "${ad}" süzgeçten geçmemeli`);
    }
  }
});

test('ayar dosyasındaki kapı favorileri yüklemede ayıklanır ve sessiz kalmaz (engellenenFavoriler + atilanlar)', () => {
  const kapilar = ENVANTER.filter(kapiMi);
  const ham = { semaSurumu: 3, favoriler: kapilar.map((v) => ({ entity_id: v.entity_id, ad: v.attributes.friendly_name })) };
  const { ayarlar, atilanlar } = ayarlariDuzelt(ham, { varsayilan: {} });
  for (const f of ayarlar.favoriler) {
    assert.equal(kapiMi({ entity_id: f.entity_id, attributes: { friendly_name: f.ad } }), false, `${f.entity_id} favoride kalmamalı`);
  }
  assert.equal(atilanlar.filter((a) => a.neden !== 'tekrar').length, ham.favoriler.length, 'hepsi ayıklanmalı ve bildirilmeli');
  assert.ok(ayarlar.engellenenFavoriler.length > 0, 'ayıklananlar kayda geçmeli');
  assert.deepEqual(favorileriDuzelt(ham.favoriler).favoriler.filter((f) => kapiMi({ entity_id: f.entity_id, attributes: { friendly_name: f.ad } })), []);
});

test('favori kaydı: kapı varlıkları güvenli listede olmasa da, mevcut favori olsa da yeni favoriye GİRMEZ', () => {
  const kapilar = ENVANTER.filter(kapiMi);
  const mevcut = kapilar.map((v) => ({ entity_id: v.entity_id, ad: v.attributes.friendly_name }));
  const sonuc = favorileriBirlestir({
    mevcut,
    secilen: kapilar.map((v) => ({ entity_id: v.entity_id, onay: false })),
    guvenliListe: new Map(), // süzgeç hiçbirini listelemedi
    tumKimlikler: new Set(kapilar.map((v) => v.entity_id)), // HA'da var
  });
  assert.deepEqual(sonuc.yeni, []);
  assert.equal(sonuc.engelli.length, kapilar.length);
  // "HA'da şu an yok" yolu bile kapı adlı kaydı KORUMAZ: kayıtlı ad da süzgeçten geçmeli.
  const yok = favorileriBirlestir({ mevcut, secilen: mevcut, guvenliListe: new Map(), tumKimlikler: new Set() });
  assert.deepEqual(yok.yeni, []);
  assert.deepEqual(yok.eksik, []);
});

test('favori alanları kapalı bir küme: kilit, alarm, siren, kepenk/kapı (cover), kamera, vana hiçbir zaman favori olamaz', () => {
  assert.deepEqual(
    Object.keys(FAVORI_ALANLARI).sort(),
    ['button', 'fan', 'input_boolean', 'input_button', 'light', 'scene', 'script', 'switch'],
  );
  for (const alan of YASAK_ALANLAR) assert.ok(!Object.hasOwn(FAVORI_ALANLARI, alan));
  for (const alan of ['lock', 'alarm_control_panel', 'cover', 'valve', 'siren', 'camera', 'automation', 'lawn_mower', 'update']) {
    assert.equal(guvenliVarlikMi({ entity_id: `${alan}.deneme`, attributes: { friendly_name: 'Deneme' } }), false, alan);
  }
  // 1.4.0: karo/favori alanları alan-kaydi.js tablosunda kapalı bir kümedir (iklim, medya... eklendi; kapı alanları yok).
  const { KARO_ALAN_SIRASI } = require('../src/lib/alan-kaydi');
  assert.deepEqual([...KARO_ALAN_SIRASI].sort(), [
    'binary_sensor', 'button', 'climate', 'fan', 'humidifier', 'input_boolean', 'input_button', 'input_number', 'input_select',
    'light', 'media_player', 'number', 'scene', 'script', 'select', 'sensor', 'switch', 'timer', 'vacuum', 'weather',
  ]);
  assert.equal(guvenliVarlikMi({ entity_id: 'climate.salon', attributes: { friendly_name: 'Salon kliması' } }), true);
  // Servisler: yalnız zararsız üç servis.
  assert.deepEqual([...new Set(Object.values(FAVORI_ALANLARI).map((a) => a.servis))].sort(), ['press', 'toggle', 'turn_on']);
});

test('açık eylem listeleri ve varsayılan ayarlar kapı sözcüğü içermez', () => {
  for (const kimlik of [...YIKICI_KIMLIKLER, ...ZARARSIZ_KIMLIKLER]) {
    assert.equal(adGuvenliMi(kimlik, ''), true, `${kimlik}: hazır listede kapı sözcüğü olmamalı`);
  }
  const varsayilan = oku('varsayilan-ayarlar.json');
  assert.deepEqual(JSON.parse(varsayilan).favoriler, []);
  assert.equal(KAPI_KOKLERI.test(sadelestir(varsayilan)), false);
  // Süzgeç sözcük listesi bu sınama kehanetiyle uyumlu (kök eksilirse yakalanır).
  for (const kok of ['kapi', 'door', 'kilit', 'kilid', 'alarm', 'garaj', 'bariyer', 'gate', 'lock']) {
    assert.ok(YASAK_KELIMELER.some((k) => k.startsWith(kok) || k === kok), `${kok} kökü süzgeçte olmalı`);
  }
});

test('yıkıcı eylem kısayola ve komut satırına asla atanamaz; YASAK hiçbir yüzeyde izin almaz', () => {
  for (const kaynak of ['kisayol', 'komut-satiri']) {
    assert.equal(kaynakIzni(SINIF.YIKICI, kaynak).izin, false);
    assert.equal(kaynakIzni(SINIF.YASAK, kaynak).izin, false);
  }
  for (const kaynak of KAYNAKLAR) assert.equal(kaynakIzni(SINIF.YASAK, kaynak).izin, false);
  assert.equal(kaynakIzni('bilinmeyen', 'tepsi-menu').izin, false);
  assert.equal(kaynakIzni(SINIF.ZARARSIZ, 'bilinmeyen-yuzey').izin, false);
});

/** src/ altındaki tüm .js dosyaları: [göreli yol, içerik]. */
function kaynaklariTara(klasor = 'src') {
  const sonuc = [];
  for (const ad of fs.readdirSync(path.join(KOK, klasor), { withFileTypes: true })) {
    const goreli = `${klasor}/${ad.name}`;
    if (ad.isDirectory()) sonuc.push(...kaynaklariTara(goreli));
    else if (ad.name.endsWith('.js')) sonuc.push([goreli, oku(goreli)]);
  }
  return sonuc;
}

test('servis çağrısı TEK yerde (src/lib/eylem-hatti.js) yapılır; oradan önce süzgeç, sınıf, yüzey izni, servis listesi ve hız sınırı gelir', () => {
  const kaynaklar = kaynaklariTara();
  assert.deepEqual(
    kaynaklar.filter(([, icerik]) => icerik.includes('/api/services/')).map(([ad]) => ad),
    ['src/lib/eylem-hatti.js'],
    'servis çağrısı yolu yalnız eylem hattında geçer (ana süreç, panel, palet, kısayol, komut satırı hep o hattan geçer)',
  );
  const hat = oku('src/lib/eylem-hatti.js');
  assert.equal(hat.match(/\/api\/services\//g)?.length, 1, 'tek servis çağrısı noktası');
  assert.equal(hat.match(/yontem:\s*'POST'/g)?.length, 1);
  assert.equal(oku('src/main.js').match(/yontem:\s*'POST'/g)?.length ?? 0, 0, 'main.js hiçbir yerde doğrudan POST yapmaz');

  const bas = hat.indexOf('return async function calistir(');
  const govde = hat.slice(bas);
  const servis = govde.indexOf('/api/services/');
  assert.ok(servis > 0);
  for (const isaret of [
    'adGuvenliMi(kimlik, ad)',
    'guncelDurum(kimlik)',
    'guvenliVarlikMi(varlik)',
    'eylemSinifi(varlik, favori, istenenServis(eylem))',
    'kaynakIzni(',
    'basiliOnayi(kimlik)',
    'servisKur(alan, kimlik, favori, eylem, varlik)',
    'hizSiniri.dene(',
  ]) {
    const yer = govde.indexOf(isaret);
    assert.ok(yer > 0, `${isaret} hatta bulunmalı`);
    assert.ok(yer < servis, `${isaret} servis çağrısından ÖNCE olmalı`);
  }
  assert.ok(govde.indexOf('guvenliVarlikMi(varlik)') < govde.indexOf('eylemSinifi(varlik, favori, istenenServis(eylem))'), 'önce süzgeç, sonra sınıf');
  assert.ok(govde.includes("'onay-gerekli'"));
  // Kapı/kilit servisleri koda hiç yazılmamış.
  for (const [ad, icerik] of kaynaklar) {
    assert.ok(!/open_cover|unlock_door|lock\/unlock|\/api\/services\/(lock|cover|alarm_control_panel)/.test(icerik), `${ad}: kapı/kilit servisi yok`);
  }
});

test('eylem yalnız kullanıcı hareketinden başlar: tepsi tıklaması, panel/palet IPC, kısayol, komut satırı; açılış ve zamanlayıcı yolunda çağrı yok', () => {
  const main = oku('src/main.js');
  // kayitKaynagiEkle bir eylem DEĞİL, kayıt kaynağı tanımıdır (1.4.0: ayardaki bilgi varlıkları); eylemi yine hat/izin listeleri denetler.
  const cagrilar = [...main.matchAll(/\beylem\.(\w+)\(/g)].map((m) => m[1]).filter((ad) => ad !== 'kayitKaynagiEkle').sort();
  assert.deepEqual(cagrilar, ['komutSatirindan', 'kisayolla', 'tepsiTikla'].sort(), 'main.js yalnız bu üç giriş noktasını çağırır');
  assert.deepEqual([...main.matchAll(/\beylem\.kayitKaynagiEkle\((.*)\);/g)].map((m) => m[1]), ['bilgiKaydi(() => ayarlar)'], 'kayıt kaynağı yalnız ayardaki bilgi varlıklarını kaydeder');
  // Üç giriş noktası da kullanıcı olayına bağlı bir kapanışın içinde: menü tıklaması, global kısayol, ikinci kopya/komut satırı.
  assert.match(main, /const tikla = \(\) => eylem\.tepsiTikla\(oge\.kimlik\);/);
  assert.match(main, /else if \(oge\.tur === 'favori'\) is = \(\) => eylem\.kisayolla\(oge\.kimlik\);/);
  assert.match(main, /if \(kisayolTekrarEngeli\.gec\(oge\.kisayol\)\) is\(\);/, 'kısayol işi yinelenen tetikleme engelinden geçer');
  assert.match(main, /return eylem\.komutSatirindan\(ad\);/);
  // Panel/palet eylemi yalnız yüzey IPC'sinden (gönderen denetimli) gelir.
  const yuzey = oku('src/yuzey-yoneticisi.js');
  assert.equal(yuzey.match(/eylem\.yuzeydenCalistir\(/g)?.length, 1);
  const bloklar = yuzey.slice(yuzey.indexOf("ipcMain.handle('yuzey:calistir'"));
  assert.ok(bloklar.indexOf('yuzeydenMi(olay)') < bloklar.indexOf('eylem.yuzeydenCalistir('), 'gönderen denetimi eylemden ÖNCE');
});

test('hızlı panel/palet/tepsi/kısayol/komut satırı/Son/hazır liste: kapı-kilit hiçbir yüzeye ve listeye girmez (örnek envanterle)', () => {
  const { yuzeyModeliOlustur, karolariOlustur } = require('../src/lib/yuzey-modeli');
  const { tepsiMenuPlani } = require('../src/lib/tepsi-menu');
  const { komutSatiriEylemi, eylemAdiniCoz } = require('../src/lib/komut-satiri');
  const { kisayolPlani } = require('../src/lib/kisayol');
  const { sonKullanilanlarOlustur } = require('../src/lib/son-kullanilanlar');
  const { HAZIR_LISTE, hazirListeUygula } = require('../src/lib/favoriler');
  const kapilar = ENVANTER.filter(kapiMi);
  assert.ok(kapilar.length >= 5);
  const kapiFavorileri = kapilar.map((v) => ({ entity_id: v.entity_id, ad: v.attributes.friendly_name, kisayol: 'Control+Alt+K', etiket: 'Güvenli' }));

  // 1. yüzey modeli: canlı durum olsa da olmasa da kapı karosu yok
  const durumAl = (kimlik) => ENVANTER.find((v) => v.entity_id === kimlik);
  const model = yuzeyModeliOlustur({ favoriler: kapiFavorileri, durumAl, sonKimlikler: kapilar.map((v) => v.entity_id), baglanti: { baglanti: 'canli', canli: true } });
  assert.deepEqual(model.gruplar.flatMap((g) => g.karolar), []);
  assert.deepEqual(model.sonlar, [], '"Son" listesine de girmez');

  // 2. tepsi planı: karolar yalnız süzülmüş karo üreticisinden (favori sırasında) gelir (plan kendisi süzmez)
  assert.ok(oku('src/main.js').includes('tepsiMenuPlani(favoriKarolari()'));
  assert.ok(oku('src/main.js').includes('return karolariOlustur(ayarlar?.favoriler ?? [], (kimlik) => depo.al(kimlik), t);'));
  const favoriKarolari = karolariOlustur(kapiFavorileri, durumAl);
  assert.deepEqual(favoriKarolari, [], 'favori sırasındaki karo listesinde de kapı yok');
  const plan = tepsiMenuPlani(favoriKarolari);
  assert.deepEqual([plan.ust, plan.alt, plan.yikici], [[], [], []]);

  // 3. komut satırı: kapı adları hiç çözülmez (karolar süzülmüş modelden gelir)
  const karolar = model.gruplar.flatMap((g) => g.karolar);
  for (const v of kapilar) assert.ok(eylemAdiniCoz(v.attributes.friendly_name, karolar).hata, `${v.entity_id}: komut satırından çözülmemeli`);
  assert.equal(komutSatiriEylemi(['x', '--eylem=Ön Kapı'])?.ad, 'Ön Kapı', 'ad ayrıştırılır ama karolar arasında yoksa eylem çalışmaz');

  // 4. kısayol planı: kapı favorisine kısayol atanamaz
  const siniflandir = (kimlik, f) => eylemSinifi({ entity_id: kimlik, attributes: { friendly_name: f?.ad ?? kimlik } }, f).sinif;
  const ksPlan = kisayolPlani({ ana: 'Control+Alt+H', palet: 'Control+Alt+P', favoriler: kapiFavorileri, panolar: [], siniflandir });
  assert.deepEqual(ksPlan.filter((o) => o.tur === 'favori' && o.gecerli), []);

  // 5. "Son" deposu yalnız bilinen güvenli kimlikleri geri verir
  const gecici = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-paneli-degismez-'));
  const son = sonKullanilanlarOlustur({ dosyaYolu: path.join(gecici, 'son.json'), fs, gunluk() {} });
  for (const v of kapilar) son.ekle(v.entity_id);
  assert.deepEqual(yuzeyModeliOlustur({ favoriler: kapiFavorileri, durumAl, sonKimlikler: son.en(8), baglanti: {} }).sonlar, []);
  son.bosalt();
  fs.rmSync(gecici, { recursive: true, force: true });

  // 6. hazır liste: sabit tabloda kapı yok; HA'da kapı da olsa eklenmez
  for (const h of HAZIR_LISTE) assert.equal(adGuvenliMi(h.kimlik, h.etiket), true, `${h.kimlik}: hazır listede kapı yok`);
  const sonuc = hazirListeUygula([], ENVANTER);
  for (const f of sonuc.favoriler) assert.equal(kapiMi({ entity_id: f.entity_id, attributes: { friendly_name: f.ad } }), false, `${f.entity_id} hazır listeden gelmemeli`);
});

test('yüzey IPC kanallarının hepsi gönderen denetimli; panel/palet penceresi sandbox + contextIsolation, yalnız yerel dosya', () => {
  const yuzey = oku('src/yuzey-yoneticisi.js');
  const kanallar = [...yuzey.matchAll(/ipcMain\.(?:handle|on)\('(yuzey:[\w-]+)'/g)].map((m) => m[1]);
  assert.deepEqual(kanallar.sort(), ['yuzey:ayarlar-ac', 'yuzey:basili-basla', 'yuzey:basili-birak', 'yuzey:boyut', 'yuzey:calistir', 'yuzey:durum-al', 'yuzey:ha-ac', 'yuzey:kapat', 'yuzey:oku', 'yuzey:sag-tik']);
  for (const kanal of kanallar) {
    const yer = yuzey.indexOf(`'${kanal}'`);
    const sonraki = yuzey.indexOf('ipcMain.', yer + 10);
    const blok = yuzey.slice(yer, sonraki < 0 ? undefined : sonraki);
    assert.ok(blok.includes('yuzeydenMi(olay)'), `${kanal}: gönderen denetimi şart`);
  }
  const html = oku('src/yuzey.html');
  assert.match(html, /default-src 'none'/);
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, /unsafe-inline|unsafe-eval/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/i, 'satır içi betik yok');
});

test('GÜVENLİK KURALI metni Ayarlar ekranında tüm sözcükleri sayar', () => {
  const html = sadelestir(oku('src/ayarlar.html'));
  for (const soz of ['kapi', 'door', 'kilit', 'lock', 'alarm', 'garaj', 'bariyer', 'gate']) {
    assert.ok(html.includes(soz), `Ayarlar ekranındaki güvenlik kuralı "${soz}" sözcüğünü içermeli`);
  }
});

test('ayarlar.js kapı/kilit varlığını arayüzde kendi başına seçilebilir yapmaz: engelli satırlar seçilemez', () => {
  const js = oku('src/ayarlar.js');
  assert.match(js, /secilebilir:\s*false,\s*\n\s*sinifAdi:\s*'satir-engelli'/);
  // Favori yükü yalnız seçili kimlikleri taşır; ana süreç yine süzer (favoriler:kaydet -> favorileriBirlestir).
  assert.match(js, /entity_id:\s*kimlik/);
});
