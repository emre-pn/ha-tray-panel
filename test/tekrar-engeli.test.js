'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SONUMLEME_MS, tekrarEngeliOlustur } = require('../src/lib/tekrar-engeli');

function saatli() {
  let t = 5000;
  const engel = tekrarEngeliOlustur({ simdi: () => t });
  return { engel, ilerle: (ms) => (t += ms) };
}

test('tekrar engeli: ilk basış geçer; basılı tutulan tuşun klavye tekrarları (her ~33 ms) yok sayılır, tek tetikleme sayılır', () => {
  const { engel, ilerle } = saatli();
  assert.equal(engel.gec('Control+Alt+L'), true);
  let gecen = 0;
  for (let i = 0; i < 90; i += 1) {
    ilerle(33); // 3 sn boyunca basılı tutma
    if (engel.gec('Control+Alt+L')) gecen += 1;
  }
  assert.equal(gecen, 0, 'tekrarlar çalıştırılmaz');
});

test('tekrar engeli: tuş bırakılıp sönümleme süresi geçince yeniden basış çalışır; süresinden önceki ikinci basış yok sayılır', () => {
  const { engel, ilerle } = saatli();
  assert.equal(engel.gec('Control+Alt+L'), true);
  ilerle(SONUMLEME_MS - 1);
  assert.equal(engel.gec('Control+Alt+L'), false, 'süre dolmadan gelen yok sayılır (ve süreyi yeniden başlatır)');
  ilerle(SONUMLEME_MS - 1);
  assert.equal(engel.gec('Control+Alt+L'), false);
  ilerle(SONUMLEME_MS);
  assert.equal(engel.gec('Control+Alt+L'), true, 'bırakıp bekledikten sonra yeniden çalışır');
});

test('tekrar engeli: kısayollar birbirinden bağımsızdır; temizle her şeyi sıfırlar', () => {
  const { engel } = saatli();
  assert.equal(engel.gec('Control+Alt+L'), true);
  assert.equal(engel.gec('Control+Alt+P'), true, 'başka kısayol etkilenmez');
  assert.equal(engel.gec('Control+Alt+L'), false);
  engel.temizle();
  assert.equal(engel.gec('Control+Alt+L'), true);
});
