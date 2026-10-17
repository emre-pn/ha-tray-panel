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

test('favori alanları kapalı bir küme: kilit, alarm, siren, kamera hiçbir zaman favori olamaz; cover yalnız perde sınıfıyla, vana ve otomasyon zorunlu onayla', () => {
  assert.deepEqual(
    Object.keys(FAVORI_ALANLARI).sort(),
    ['button', 'fan', 'input_boolean', 'input_button', 'light', 'scene', 'script', 'switch'],
  );
  for (const alan of YASAK_ALANLAR) assert.ok(!Object.hasOwn(FAVORI_ALANLARI, alan));
  for (const alan of ['lock', 'alarm_control_panel', 'siren', 'camera', 'lawn_mower', 'update']) {
    assert.equal(guvenliVarlikMi({ entity_id: `${alan}.deneme`, attributes: { friendly_name: 'Deneme' } }), false, alan);
  }
  // 1.4.0 cihaz grubu: cover sınıfı bilinmeden (ya da garaj/kepenk/kapı sınıfıyla) güvenli sayılmaz; perde sınıfıyla sayılır.
  assert.equal(guvenliVarlikMi({ entity_id: 'cover.deneme', attributes: { friendly_name: 'Deneme' } }), false, 'sınıfsız cover');
  assert.equal(guvenliVarlikMi({ entity_id: 'cover.deneme', attributes: { friendly_name: 'Deneme', device_class: 'garage' } }), false, 'garaj sınıfı');
  assert.equal(guvenliVarlikMi({ entity_id: 'cover.deneme', attributes: { friendly_name: 'Deneme', device_class: 'curtain' } }), true, 'perde sınıfı');
  assert.equal(guvenliVarlikMi({ entity_id: 'valve.deneme', attributes: { friendly_name: 'Deneme' } }), true, 'vana (zorunlu onaylı)');
  assert.equal(guvenliVarlikMi({ entity_id: 'automation.deneme', attributes: { friendly_name: 'Deneme' } }), true, 'otomasyon (zorunlu onaylı)');
  // 1.4.0: karo/favori alanları alan-kaydi.js tablosunda kapalı bir kümedir (iklim, medya... eklendi; kapı alanları yok).
  const { KARO_ALAN_SIRASI } = require('../src/lib/alan-kaydi');
  assert.deepEqual([...KARO_ALAN_SIRASI].sort(), [
    'automation', 'binary_sensor', 'button', 'climate', 'cover', 'fan', 'humidifier', 'input_boolean', 'input_button', 'input_number', 'input_select',
    'light', 'media_player', 'number', 'scene', 'script', 'select', 'sensor', 'switch', 'timer', 'vacuum', 'valve', 'weather',
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
  // Kapı/kilit servisleri koda hiç yazılmamış. (1.4.0 cihaz grubu: cover servisleri perde/jaluzi içindir; kapı ve garajı süzgeç (suzgec.js PERDE_SINIFLARI)
  // dışarıda tutar. Kilit ve alarm servisleri hâlâ hiçbir yerde yoktur.)
  for (const [ad, icerik] of kaynaklar) {
    assert.ok(!/unlock_door|lock\/unlock|\/api\/services\/(lock|alarm_control_panel)/.test(icerik), `${ad}: kapı/kilit servisi yok`);
  }
});

test('eylem yalnız kullanıcı hareketinden başlar: tepsi tıklaması, panel/palet IPC, kısayol, komut satırı; açılış ve zamanlayıcı yolunda çağrı yok', () => {
  const main = oku('src/main.js');
  // kayitKaynagiEkle bir eylem DEĞİL, kayıt kaynağı tanımıdır (1.4.0: ayardaki bilgi varlıkları); eylemi yine hat/izin listeleri denetler.
  const cagrilar = [...main.matchAll(/\beylem\.(\w+)\(/g)].map((m) => m[1]).filter((ad) => ad !== 'kayitKaynagiEkle').sort();
  assert.deepEqual(cagrilar, ['komutSatirindan', 'kisayolla', 'tepsiOrtaTikla', 'tepsiTikla'].sort(), 'main.js yalnız bu dört giriş noktasını çağırır');
  assert.deepEqual([...main.matchAll(/\beylem\.kayitKaynagiEkle\((.*)\);/g)].map((m) => m[1]), ['bilgiKaydi(() => ayarlar)'], 'kayıt kaynağı yalnız ayardaki bilgi varlıklarını kaydeder');
  // Üç giriş noktası da kullanıcı olayına bağlı bir kapanışın içinde: menü tıklaması, global kısayol, ikinci kopya/komut satırı.
  assert.match(main, /const tikla = \(\) => eylem\.tepsiTikla\(oge\.kimlik\);/);
  assert.match(main, /else if \(oge\.tur === 'favori'\) is = \(\) => eylem\.kisayolla\(oge\.kimlik\);/);
  assert.match(main, /if \(kisayolTekrarEngeli\.gec\(oge\.kisayol\)\) is\(\);/, 'kısayol işi yinelenen tetikleme engelinden geçer');
  assert.match(main, /return eylem\.komutSatirindan\(ad\);/);
  // Tepsi orta tık (1.4.0, o-20): yalnız tepsinin 'middle-click' olayında, ayardaki tek kimlik için ve yinelenen tetikleme engelinden sonra.
  assert.match(main, /tepsi\.on\('middle-click', \(\) => \{[\s\S]*?ortaTikEngeli\.gec\('orta-tik'\)[\s\S]*?eylem\.tepsiOrtaTikla\(kimlik\)/);
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
  // 1.4.0 dis grubu (o-54): yuzey:dis-onay-al / yuzey:dis-onay-yanit (evpaneli:// bağlantı izni) bilinçli eklendi
  // eylem grubu (o-12, o-14, o-15, o-46): yuzey:geri-al, yuzey:geciktir, yuzey:gecikmeli-iptal, yuzey:oda-kapat, yuzey:diger-* bilinçli eklendi
  assert.deepEqual(kanallar.sort(), ['yuzey:ayarlar-ac', 'yuzey:basili-basla', 'yuzey:basili-birak', 'yuzey:bildirim-kapat', 'yuzey:boyut', 'yuzey:calistir', 'yuzey:diger-calistir', 'yuzey:diger-cihazlar', 'yuzey:diger-favori-ekle', 'yuzey:dis-onay-al', 'yuzey:dis-onay-yanit', 'yuzey:durum-al', 'yuzey:gecikmeli-iptal', 'yuzey:geciktir', 'yuzey:geri-al', 'yuzey:ha-ac', 'yuzey:kamera', 'yuzey:kapat', 'yuzey:oda-kapat', 'yuzey:oku', 'yuzey:sabitle', 'yuzey:sag-tik']);
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

// ---------------------------------------------------------------------------
// 1.4.0 pencere grubu: masaüstü karoları (o-33) ve tepsi rozeti (o-27) yeni yüzeylerdir; Kapı Kuralı onlar için de değişmez
// ---------------------------------------------------------------------------

test('masaüstü karoları ve tepsi rozeti: kapı/kilit/alarm/perde varlıkları karo ya da rozet OLAMAZ (örnek envanter ve kandırmacalarla)', () => {
  const { sabitlenecekKarolar, sabitlenebilirKimlikMi } = require('../src/lib/masaustu-karo');
  const { sensorRozeti, sensorIpucuEki } = require('../src/lib/tepsi-simgesi');
  const kapilar = ENVANTER.filter(kapiMi);
  assert.ok(kapilar.length >= 5);
  const t = (anahtar) => anahtar;

  // 1. Envanterdeki her kapı varlığı: favori ve seçili olsa da, canlı durumu varken de karo olmaz.
  const durumlar = new Map(ENVANTER.map((v) => [v.entity_id, { ...v, state: 'on' }]));
  const sonuc = sabitlenecekKarolar({
    secili: kapilar.map((v) => v.entity_id),
    favoriler: kapilar.map((v) => ({ entity_id: v.entity_id, ad: v.attributes.friendly_name })),
    durumAl: (kimlik) => durumlar.get(kimlik),
    t,
  });
  assert.deepEqual(sonuc, []);

  // 2. Kandırmacalar: kimliği zararsız alanlarda (ışık/anahtar/sensör/sahne) ama adı kapıyı belli edenler.
  const kandirmaca = [
    { entity_id: 'light.salon_lambasi', ad: 'Ön Kapı Lambası' },
    { entity_id: 'switch.priz', ad: 'Garaj Prizi' },
    { entity_id: 'sensor.sicaklik', ad: 'Kilit pili' },
    { entity_id: 'sensor.salon_sicaklik', ad: 'Ga​rage sıcaklığı' },
    { entity_id: 'scene.gece', ad: 'Alarm kur' },
  ];
  const kandirmacaSonucu = sabitlenecekKarolar({
    secili: kandirmaca.map((k) => k.entity_id),
    favoriler: kandirmaca,
    durumAl: (kimlik) => ({ entity_id: kimlik, state: '21', attributes: { friendly_name: kandirmaca.find((k) => k.entity_id === kimlik).ad, unit_of_measurement: '°C' } }),
    t,
  });
  assert.deepEqual(kandirmacaSonucu, [], 'adı kapıyı belli eden hiçbir varlık karo olmaz');

  // Kapı sınıflı binary_sensor (kimlik ve ad masum): canlı durumdaki sınıf süzgeci karoyu düşürür.
  const siniflar = ['door', 'garage_door', 'opening', 'window', 'lock', 'tamper', 'safety'];
  const sinifli = siniflar.map((sinif) => ({ entity_id: `binary_sensor.algilayici_${sinif.replace('_', '')}`, sinif }));
  const sinifSonucu = sabitlenecekKarolar({
    secili: sinifli.map((s) => s.entity_id),
    favoriler: sinifli.map((s) => ({ entity_id: s.entity_id, ad: 'Algılayıcı' })),
    durumAl: (kimlik) => ({ entity_id: kimlik, state: 'off', attributes: { friendly_name: 'Algılayıcı', device_class: sinifli.find((s) => s.entity_id === kimlik).sinif } }),
    t,
  });
  assert.deepEqual(sinifSonucu, [], 'kapı/pencere/açıklık/kilit/kurcalama/güvenlik sınıfları masaüstüne sabitlenmez');
  for (const kimlik of ['lock.on_kapi', 'cover.garaj', 'alarm_control_panel.ev', 'camera.bahce', 'siren.ic', 'climate.salon', 'script.x', 'button.pc_kapat']) {
    assert.equal(sabitlenebilirKimlikMi(kimlik), false, `${kimlik} sabitlenemez`);
  }

  // 3. Rozet: sensör adı kapıyı belli ediyorsa ne rozet ne tepsi ipucu eki üretilir; zararsız sensör üretilir.
  for (const v of kapilar) {
    const varlik = { entity_id: `sensor.${v.entity_id.split('.')[1]}`, state: '12', attributes: { friendly_name: v.attributes.friendly_name, unit_of_measurement: '%' } };
    assert.equal(sensorRozeti(varlik), null, `${varlik.entity_id}: kapı sensörü rozet olmaz`);
    assert.equal(sensorIpucuEki(varlik), null, `${varlik.entity_id}: kapı sensörü tepsi ipucuna girmez`);
  }
  assert.equal(sensorRozeti({ entity_id: 'sensor.pil', state: '12', attributes: { friendly_name: 'Telefon pili', unit_of_measurement: '%' } })?.metin, '12');
  assert.equal(sensorRozeti({ entity_id: 'sensor.giris_kapisi', state: '1', attributes: { friendly_name: 'Giriş', unit_of_measurement: '%' } }), null);
  assert.equal(sensorRozeti({ entity_id: 'lock.on_kapi', state: '12', attributes: { friendly_name: 'Ön kapı' } }), null, 'sensör olmayan alan rozet olmaz');
  assert.equal(sensorRozeti({ entity_id: 'light.salon', state: '12', attributes: {} }), null);
});

test('masaüstü karosu eylemi tek yoldan geçer: karo sayfası kimlik/servis gönderemez, eylem YALNIZ karo yöneticisinden ve gönderen denetiminden sonra çağrılır', () => {
  const kaynaklar = kaynaklariTara();
  assert.deepEqual(
    kaynaklar.filter(([, icerik]) => /\.masaustundenCalistir\(/.test(icerik)).map(([ad]) => ad),
    ['src/masaustu-karolari.js'],
    'eylem.masaustundenCalistir yalnız masaüstü karo yöneticisinden çağrılır (main.js doğrudan çağırmaz)',
  );
  const yonetici = oku('src/masaustu-karolari.js');
  const kanal = yonetici.slice(yonetici.indexOf("ipcMain.handle('karo:calistir'"), yonetici.indexOf("ipcMain.on('karo:kaldir'"));
  assert.ok(kanal.indexOf('karodanBul(olay)') >= 0 && kanal.indexOf('karodanBul(olay)') < kanal.indexOf('eylem.masaustundenCalistir('), 'gönderen denetimi eylemden ÖNCE');
  assert.ok(kanal.indexOf('karoYukunuDuzelt(yuk)') < kanal.indexOf('eylem.masaustundenCalistir('), 'yük doğrulaması eylemden ÖNCE');
  assert.doesNotMatch(kanal, /yuk\.kimlik|duzgun\.kimlik|yuk\.servis|duzgun\.servis/, 'karo kimliği sayfadan alınmaz; yalnız pencere kaydındaki kimlik kullanılır');
  const cagrilar = [...kanal.matchAll(/eylem\.masaustundenCalistir\(\{([^}]*)\}\)/g)];
  assert.equal(cagrilar.length, 2);
  for (const cagri of cagrilar) {
    assert.match(cagri[1], /^\s*kimlik: e\.kimlik(, parlaklik: duzgun\.parlaklik)?\s*$/, 'eyleme yalnız pencereye bağlı kimlik (ve doğrulanmış parlaklık) gider');
  }
  // Karo yöneticisi kendi içinde HA'ya istek göndermez ve servis adı taşımaz.
  assert.doesNotMatch(yonetici, /\/api\/|yontem:|fetch\(|net\.request/, 'karo yöneticisi ağa çıkmaz');
  assert.doesNotMatch(yonetici, /light\/toggle|turn_on|turn_off|unlock|open_cover/, 'servis adları eylem hattında kalır');
  // Eylem tarafı: kaynak "masaustu" yıkıcı eylemi ve yasak sınıfı reddeder; yalnız zararsız çalışır.
  assert.equal(kaynakIzni(SINIF.YIKICI, 'masaustu').izin, false);
  assert.equal(kaynakIzni(SINIF.YASAK, 'masaustu').izin, false);
  assert.equal(kaynakIzni(SINIF.ZARARSIZ, 'masaustu').izin, true);
  // Ana süreç eylemi karodan başlatmaz (üç kullanıcı giriş noktası değişmedi). kayitKaynagiEkle eylem DEĞİL: yalnız kayıtlı varlık
  // kaynağı bildirir (bilgi kartlarının seçili varlıkları; bilgi-modeli.js bilgiKaydi).
  const mainEylemleri = [...oku('src/main.js').matchAll(/\beylem\.(\w+)\(/g)].map((m) => m[1]).filter((ad) => ad !== 'kayitKaynagiEkle');
  assert.deepEqual(mainEylemleri.sort(), ['komutSatirindan', 'kisayolla', 'tepsiOrtaTikla', 'tepsiTikla'].sort());
});

test('masaüstü karosu penceresi: yalnız yerel dosya, sandbox + contextIsolation, CSP satır içi betik yok, innerHTML yok', () => {
  const html = oku('src/masaustu-karo.html');
  assert.match(html, /default-src 'none'/);
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, /unsafe-inline|unsafe-eval/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/i, 'satır içi betik yok');
  const sayfa = oku('src/masaustu-karo-sayfa.js').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(sayfa, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/, 'karo sayfası yalnız textContent ile yazar');
  const yerel = oku('src/yerel-pencere.js');
  assert.match(yerel, /sandbox:\s*true/);
  assert.match(yerel, /contextIsolation:\s*true/);
  assert.match(yerel, /nodeIntegration:\s*false/);
  assert.match(oku('src/masaustu-karolari.js'), /yerelPencereOlustur\(/, 'pencere ortak yerel-pencere kurucusundan çıkar (uzak adres gezinmesi engelli)');
});

test('dış tetikler (1.4.0 dis grubu) tek kapıdan geçer: distenCalistir yalnız kapıda; yerel API yalnız 127.0.0.1; kayıt defteri yalnız "reg query" ile okunur', () => {
  const kaynaklar = kaynaklariTara();
  // Eylem katmanının dış girişi YALNIZ kapı (src/lib/dis-tetik.js) ve düzenleyicinin erişim anahtarı sarmalayıcısıdır; main.js eylem başlatmaz.
  assert.deepEqual(
    kaynaklar.filter(([, icerik]) => /\.distenCalistir\(/.test(icerik)).map(([ad]) => ad).sort(),
    ['src/dis-tetikler.js', 'src/lib/dis-tetik.js'],
  );
  const duzenleyici = oku('src/dis-tetikler.js');
  assert.equal(duzenleyici.match(/\beylem\.distenCalistir\(/g)?.length, 1);
  assert.ok(duzenleyici.indexOf('anahtarVarMi()') < duzenleyici.indexOf('eylem.distenCalistir('), 'erişim anahtarı denetimi eylemden ÖNCE');
  assert.match(duzenleyici, /disTetikKapisiOlustur\(\{[\s\S]*?eylem: anahtarliEylem,/, 'kapıya yalnız sarmalayıcı verilir');
  assert.equal(oku('src/lib/dis-tetik.js').match(/\beylem\.distenCalistir\(/g)?.length, 1, 'kapı eylemi tek yerden, tüm denetimlerden sonra çağırır');
  // main.js dış istekleri yalnız düzenleyiciye iletir (bağlantı, Jump List / kısayol, PC olayı)
  const main = oku('src/main.js');
  assert.match(main, /disTetikler\.protokoldan\(istek\.metin\)/);
  assert.match(main, /disTetikler\.komutSatirindan\(\{ ad: eylemIstegi\.ad, kaynak: istek\.kaynak \}\)/);
  assert.match(main, /powerMonitor\.on\(olayAdi, \(\) => disTetikler\.guc\(pcOlayi\)\)/);
  // Yerel API yalnız geri döngü adresini dinler; CORS başlığı yazılmaz
  const api = oku('src/lib/yerel-api.js');
  assert.deepEqual([...api.matchAll(/\.listen\(\{[^}]*host: '([^']+)'/g)].map((m) => m[1]), ['127.0.0.1']);
  assert.doesNotMatch(api, /Access-Control-Allow/i);
  // Alt süreç yalnız toplantı ışığının salt okunur sorgusu: başka dosya child_process/execFile kullanmaz, komut "query" dışında bir şey değil
  assert.deepEqual(kaynaklar.filter(([, icerik]) => /child_process/.test(icerik)).map(([ad]) => ad), ['src/main.js']);
  assert.deepEqual(kaynaklar.filter(([, icerik]) => /\bexecFile\(/.test(icerik)).map(([ad]) => ad), ['src/dis-tetikler.js']);
  assert.match(duzenleyici, /execFile\(program, \['query', anahtar, '\/s'\]/);
  assert.doesNotMatch(duzenleyici, /\breg(\.exe)?\s+(add|delete|import|copy|restore|load)\b|'(add|delete|import)'/i, 'kayıt defterine yazma komutu yok');
});
