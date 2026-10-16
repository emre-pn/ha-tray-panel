'use strict';

/**
 * 1.4.0 cihaz kartları, Ayarlar tarafı: yeni alanlar (klima, medya, süpürge, seçici, sayı, zamanlayıcı...) favori listesinde görünür;
 * yardımcı değişkenler (o-06) varsayılan onaylıdır ve satırda otomasyon uyarısı yazar; tek tıklama eylemi olmayan karolar
 * "Sıra ve tepsi" listesinde tepsi sayacına girmez ("Yalnız panel ve palette").
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { acilmisSayfa, AYAR_D3, CIHAZLAR_D3, satirBul, sira, onayKutusu, duzles } = require('./ayarlar-sahte');

const yeniCihaz = (kimlik, ad, alan, alanEtiketi, ek = {}) => ({
  entity_id: kimlik,
  ad,
  alan,
  alanEtiketi,
  durum: '',
  onayZorunlu: false,
  varsayilanOnay: false,
  kisayolUygun: false,
  tekTiklama: false,
  gizli: false,
  ...ek,
});

const CIHAZLAR = {
  ...CIHAZLAR_D3,
  cihazlar: [
    ...CIHAZLAR_D3.cihazlar.slice(0, 2),
    yeniCihaz('climate.salon', 'Salon klima', 'climate', 'İklim'),
    yeniCihaz('media_player.tv', 'Salon TV', 'media_player', 'Medya oynatıcılar'),
    yeniCihaz('vacuum.supurge', 'Süpürge', 'vacuum', 'Süpürgeler'),
    yeniCihaz('input_select.ev_modu', 'Ev modu', 'input_select', 'Seçiciler', { varsayilanOnay: true }),
    yeniCihaz('input_number.esik', 'Eşik', 'input_number', 'Sayılar', { varsayilanOnay: true }),
    yeniCihaz('timer.mutfak', 'Mutfak', 'timer', 'Zamanlayıcılar', { varsayilanOnay: true }),
    yeniCihaz('fan.vantilator', 'Vantilatör', 'fan', 'Vantilatörler', { tekTiklama: true, kisayolUygun: true }),
  ],
};
const AYAR = {
  ...AYAR_D3,
  favoriler: [
    { entity_id: 'climate.salon', ad: 'Salon klima' },
    { entity_id: 'input_select.ev_modu', ad: 'Ev modu' },
    { entity_id: 'light.salon_lambasi', ad: 'Salon Lambası' },
    { entity_id: 'scene.film', ad: 'Film' },
  ],
};

const notlar = (satir) => satir.bul((o) => o.className === 'cihaz-not').map((o) => o.textContent).filter(Boolean);
const konumlar = (sayfa) => sira(sayfa).map((s) => s.bul((o) => o.className.startsWith('sira-konum'))[0].textContent);

test('yeni alanlar cihaz listesinde türleriyle görünür; tek tıklama eylemi olmayanlarda kısayol kutusu yoktur', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR });
  for (const [kimlik, tur] of [
    ['climate.salon', 'İklim'],
    ['media_player.tv', 'Medya oynatıcılar'],
    ['vacuum.supurge', 'Süpürgeler'],
    ['input_select.ev_modu', 'Seçiciler'],
  ]) {
    const satir = satirBul(sayfa, kimlik);
    assert.ok(satir, kimlik);
    assert.ok(satir.bul((o) => o.className === 'cihaz-turu' && o.textContent === tur).length === 1, `${kimlik} türü`);
  }
  const klima = satirBul(sayfa, 'climate.salon');
  assert.equal(klima.bul((o) => o.className === 'kisayol-girdisi').length, 0, 'iklim kısayola atanamaz');
  const fan = satirBul(sayfa, 'fan.vantilator');
  assert.equal(fan.bul((o) => o.className === 'kisayol-girdisi').length, 1, 'vantilatör tek tıklama eylemi olduğundan kısayol alabilir');
});

test('yardımcı değişkenler (seçici, sayı, zamanlayıcı) varsayılan onaylıdır ve satırda otomasyon uyarısı yazar; diğer alanlarda bu uyarı yoktur', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR });
  for (const kimlik of ['input_select.ev_modu', 'input_number.esik', 'timer.mutfak']) {
    const satir = satirBul(sayfa, kimlik);
    assert.equal(onayKutusu(satir).checked, true, `${kimlik}: varsayılan onaylı`);
    assert.equal(onayKutusu(satir).disabled, !satir.bul((o) => o.etiket === 'input' && o.type === 'checkbox')[0].checked, 'onay kutusu satır seçiliyken değiştirilebilir');
    assert.match(notlar(satir).join(' '), /otomasyonu tetikleyebilir/, kimlik);
    assert.match(notlar(satir).join(' '), /basılı tutmayla onay/, kimlik);
  }
  for (const kimlik of ['climate.salon', 'media_player.tv', 'vacuum.supurge']) {
    const satir = satirBul(sayfa, kimlik);
    assert.doesNotMatch(notlar(satir).join(' '), /otomasyonu tetikleyebilir/, kimlik);
    assert.match(notlar(satir).join(' '), /Tek tıklama eylemi yok/, `${kimlik}: nerede görüneceği yazar`);
    assert.equal(onayKutusu(satir).checked, false, `${kimlik}: onay kapalı başlar (mod değişimi servis düzeyinde onaylıdır)`);
  }
  const vantilator = satirBul(sayfa, 'fan.vantilator');
  assert.deepEqual(notlar(vantilator), [], 'tek tıklama eylemi olan vantilatörde not yok');
});

test('yardımcı değişken favorisinde onayı kapatmak kaydedilir (onay:false); açık bırakmak yük göndermez', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR });
  const satir = satirBul(sayfa, 'input_select.ev_modu');
  const kutu = onayKutusu(satir);
  kutu.checked = false;
  kutu.dispatchEvent({ type: 'change', target: kutu });
  sayfa.oge('btnAyarlariKaydet').dispatchEvent({ type: 'click' });
  for (let i = 0; i < 16; i += 1) await new Promise((coz) => setImmediate(coz));
  const yuk = duzles(sayfa.cagrilar.filter((c) => c[0] === 'favorileriKaydet').at(-1)[1]);
  const ev = yuk.find((f) => f.entity_id === 'input_select.ev_modu');
  assert.equal(ev.onay, false);
  assert.equal(yuk.find((f) => f.entity_id === 'climate.salon').onay, undefined, 'dokunulmayan favori onay alanı taşımaz');
});

test('"Sıra ve tepsi": tek tıklama eylemi olmayanlar "Yalnız panel ve palette" yazar ve tepsi sayacına girmez; ilk 8 zararsız sayacı yalnız tek tıklamalıları sayar', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR });
  const metinler = konumlar(sayfa);
  assert.equal(metinler.length, 4);
  assert.equal(metinler[0], 'Yalnız panel ve palette', 'klima');
  assert.equal(metinler[1], 'Yalnız panel ve palette', 'seçici onaylı olsa da tepside zaten yok');
  assert.equal(metinler[2], 'Tepsi menüsünde (1/8)', 'ilk tek tıklamalı favori birinci sırada sayılır');
  assert.equal(metinler[3], 'Tepsi menüsünde (2/8)');
});

test('"Sıra ve tepsi": eski cihaz kayıtları (tekTiklama alanı yok) eskisi gibi sayılır', async () => {
  const eski = { ...CIHAZLAR_D3 };
  const sayfa = await acilmisSayfa({ ayar: { ...AYAR_D3, favoriler: [{ entity_id: 'light.salon_lambasi', ad: 'Salon Lambası' }, { entity_id: 'scene.film', ad: 'Film' }] }, cihazlar: eski });
  assert.deepEqual(konumlar(sayfa), ['Tepsi menüsünde (1/8)', 'Tepsi menüsünde (2/8)']);
});

test('"Parlaklık ve renk ayarı" kutusu yalnız ışıkta çıkar; vantilatör / klima satırında parlaklık kutusu yoktur', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR });
  const metin = (satir) => satir.bul((o) => o.etiket === 'span').map((o) => o.textContent).join('|');
  assert.match(metin(satirBul(sayfa, 'light.salon_lambasi')), /Parlaklık ve renk ayarı/);
  assert.doesNotMatch(metin(satirBul(sayfa, 'climate.salon')), /Parlaklık/);
  assert.doesNotMatch(metin(satirBul(sayfa, 'fan.vantilator')), /Parlaklık/);
});

test('cihaz süzgeci yeni alan türünü de bulur ("iklim")', async () => {
  const sayfa = await acilmisSayfa({ ayar: AYAR, cihazlar: CIHAZLAR });
  const arama = sayfa.oge('cihazAra');
  arama.value = 'iklim';
  arama.dispatchEvent({ type: 'input' });
  const gorunen = sayfa.oge('cihazListesi').bul((o) => o.className === 'cihaz-kimlik').map((o) => o.textContent);
  assert.deepEqual(gorunen, ['climate.salon']);
});
