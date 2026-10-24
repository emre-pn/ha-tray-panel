'use strict';

// 1.4.0 dis grubu (o-21, o-47): Jump List / masaüstü kısayolu yardımcıları ve PC olayı kuralları (saf).

const test = require('node:test');
const assert = require('node:assert/strict');
const { dosyaAdiDuzelt, bosKisayolAdi, jumpListPlani, planImzasi, kisayolSecenekleri, JUMP_LIST_SINIRI } = require('../src/lib/windows-kisayol');
const { pcKurallariDuzelt, olayKurallari, GUC_OLAYLARI, OLAY_GECIKMESI_MS, EN_COK_KURAL } = require('../src/lib/pc-olaylari');

const PROGRAM = 'C:\\Program Files\\Ev Paneli\\Ev Paneli.exe';
const uygun = (ad, etiket = ad) => ({ karo: { id: `light.${ad.toLowerCase().replace(/\W/g, '_')}`, etiket }, ad });

test('dosyaAdiDuzelt: yasak karakterler, ayrılmış adlar, sondaki nokta; boş ad null', () => {
  assert.equal(dosyaAdiDuzelt('Salon ışığı'), 'Salon ışığı');
  assert.equal(dosyaAdiDuzelt('a<b>c:d"e/f\\g|h?i*j'), 'a b c d e f g h i j');
  assert.equal(dosyaAdiDuzelt('  Salon...  '), 'Salon');
  assert.equal(dosyaAdiDuzelt('CON'), 'CON_');
  assert.equal(dosyaAdiDuzelt('nul.txt'), 'nul_.txt');
  assert.equal(dosyaAdiDuzelt('???'), null);
  assert.equal(dosyaAdiDuzelt(42), null);
  assert.equal([...dosyaAdiDuzelt('ş'.repeat(80))].length, 60);
});

test('dosyaAdiDuzelt: ayrılmış aygıt adı ilk noktadan öncesine bakılır; alt çizgi o parçanın sonuna eklenir, sonuç artık ayrılmış değildir', () => {
  assert.equal(dosyaAdiDuzelt('Con. Salon'), 'Con_. Salon');
  assert.equal(dosyaAdiDuzelt('Aux.Isik'), 'Aux_.Isik');
  assert.equal(dosyaAdiDuzelt('NUL .txt'), 'NUL_.txt');
  assert.equal(dosyaAdiDuzelt('com1.x'), 'com1_.x');
  assert.equal(dosyaAdiDuzelt('LPT³.log'), 'LPT³_.log');
  assert.equal(dosyaAdiDuzelt('nul.'), 'nul_', 'sondaki nokta önce atılır');
  assert.equal(dosyaAdiDuzelt('Salon'), 'Salon');
  assert.equal(dosyaAdiDuzelt('Console'), 'Console');
  assert.equal(dosyaAdiDuzelt('Con'), 'Con_');
  assert.equal(dosyaAdiDuzelt('Salon.Con'), 'Salon.Con', 'ayrılmış parça yalnız ilk noktadan ÖNCE aranır');
  // sınır: ek karakterle de 60 kod noktasını aşmaz
  const uzun = dosyaAdiDuzelt('con.' + 'ş'.repeat(80));
  assert.ok([...uzun].length <= 60 && uzun.startsWith('con_.'), uzun);
  // her sonuç, ilk noktadan önceki parçada aygıt adı taşımaz; bosKisayolAdi bu adla .lnk üretir
  const AYRILMIS = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;
  for (const ham of ['Con. Salon', 'nul.x', 'NUL .txt', 'prn', 'COM1', 'lpt2.a.b', 'aux ']) {
    const ad = dosyaAdiDuzelt(ham);
    assert.ok(ad && !AYRILMIS.test(ad.split('.')[0].trimEnd()), ham + ' -> ' + ad);
    const lnk = bosKisayolAdi(ad, () => false);
    assert.ok(lnk.endsWith('.lnk') && !AYRILMIS.test(lnk.split('.')[0].trimEnd()), lnk);
  }
});

test('bosKisayolAdi: var olan dosyanın üzerine yazılmaz; (2), (3)... denenir', () => {
  const var_ = new Set(['Salon.lnk', 'Salon (2).lnk']);
  assert.equal(bosKisayolAdi('Salon', (d) => var_.has(d)), 'Salon (3).lnk');
  assert.equal(bosKisayolAdi('Film', () => false), 'Film.lnk');
  assert.equal(bosKisayolAdi('X', () => true), null);
  assert.equal(bosKisayolAdi('', () => false), null);
});

test('jumpListPlani: görevler favori adıyla ve --kaynak=jumplist ile; güvenli olmayan ad atlanır; en çok 10; boşsa null', () => {
  const plan = jumpListPlani({ uygunlar: [uygun('Salon'), uygun('a"b'), uygun('LED şerit', 'LED')], program: PROGRAM, aciklama: (ad) => `Çalıştır: ${ad}` });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].type, 'tasks');
  assert.deepEqual(plan[0].items.map((i) => [i.title, i.args]), [
    ['Salon', '--eylem="Salon" --kaynak=jumplist'],
    ['LED', '--eylem="LED şerit" --kaynak=jumplist'],
  ]);
  assert.equal(plan[0].items[0].program, PROGRAM);
  assert.equal(plan[0].items[0].description, 'Çalıştır: Salon');
  assert.doesNotMatch(JSON.stringify(plan), /light\./, 'kimlik görevlere yazılmaz');
  const cok = jumpListPlani({ uygunlar: Array.from({ length: 15 }, (_, i) => uygun(`Lamba ${i}`)), program: PROGRAM });
  assert.equal(cok[0].items.length, JUMP_LIST_SINIRI);
  assert.equal(jumpListPlani({ uygunlar: [], program: PROGRAM }), null);
  assert.equal(jumpListPlani({ uygunlar: [uygun('Salon')], program: '' }), null);
  // geliştirme modu: uygulama yolu tırnaklı ön argüman
  const gelistirme = jumpListPlani({ uygunlar: [uygun('Salon')], program: 'electron.exe', onekArgumanlar: ['C:\\dev\\ev paneli'] });
  assert.equal(gelistirme[0].items[0].args, '"C:\\dev\\ev paneli" --eylem="Salon" --kaynak=jumplist');
  assert.equal(planImzasi(null), 'null');
  assert.equal(planImzasi(plan), planImzasi(JSON.parse(JSON.stringify(plan))));
});

test('kisayolSecenekleri: hedef, --kaynak=kisayol argümanı, simge; güvenli olmayan ad null', () => {
  assert.deepEqual(kisayolSecenekleri({ ad: 'Salon', program: PROGRAM, aciklama: 'x' }), { target: PROGRAM, args: '--eylem="Salon" --kaynak=kisayol', description: 'x', icon: PROGRAM, iconIndex: 0 });
  assert.equal(kisayolSecenekleri({ ad: '%TEMP%', program: PROGRAM }), null);
  assert.equal(kisayolSecenekleri({ ad: 'Salon', program: '' }), null);
});

test('PC olayı kuralları: geçersiz öğe düşer, kapı/kilit kimliği yazılamaz, varsayılan işlem kapat, tekrar yok, en çok 8', () => {
  const ham = [
    { olay: 'kilit', kimlik: 'light.salon' },
    { olay: 'kilit', kimlik: 'light.salon', islem: 'ac' }, // aynı olay + kimlik
    { olay: 'uyanis', kimlik: 'light.salon', islem: 'geriYukle' },
    { olay: 'kilit', kimlik: 'lock.on_kapi' },
    { olay: 'kilit', kimlik: 'light.kapi_lambasi' },
    { olay: 'kilit', kimlik: 'cover.garaj' },
    { olay: 'patlama', kimlik: 'light.a' },
    { olay: 'uyku', kimlik: 'light.a', islem: 'sil' },
    { olay: 'uyku', kimlik: 'Light.A' },
    null,
    'x',
  ];
  assert.deepEqual(pcKurallariDuzelt(ham), [
    { olay: 'kilit', kimlik: 'light.salon', islem: 'kapat' },
    { olay: 'uyanis', kimlik: 'light.salon', islem: 'geriYukle' },
  ]);
  assert.equal(pcKurallariDuzelt('x'), undefined);
  const cok = Array.from({ length: 12 }, (_, i) => ({ olay: 'uyku', kimlik: `light.l${i}` }));
  assert.equal(pcKurallariDuzelt(cok).length, EN_COK_KURAL);
  assert.deepEqual(olayKurallari(ham, 'uyanis').map((k) => k.islem), ['geriYukle']);
  assert.deepEqual(olayKurallari(undefined, 'kilit'), []);
  assert.deepEqual(GUC_OLAYLARI, { 'lock-screen': 'kilit', 'unlock-screen': 'kilitAcildi', suspend: 'uyku', resume: 'uyanis' });
  assert.equal(OLAY_GECIKMESI_MS.uyku, 0, 'uykuya geçerken beklenmez');
});
