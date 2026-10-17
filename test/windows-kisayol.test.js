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
  assert.equal(dosyaAdiDuzelt('nul.txt'), 'nul.txt_');
  assert.equal(dosyaAdiDuzelt('???'), null);
  assert.equal(dosyaAdiDuzelt(42), null);
  assert.equal([...dosyaAdiDuzelt('ş'.repeat(80))].length, 60);
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
