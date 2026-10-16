'use strict';

/**
 * "Yenilikler" (o-40): src/lib/yenilikler.js — CHANGELOG.md bölümü düz metne çevrilir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { yenilikleriAyikla, duzMetin, SINIRLAR } = require('../src/lib/yenilikler');

const ORNEK = [
  '# Changelog',
  '',
  'Giriş metni.',
  '',
  '### 1.4.0 — 2026-11-01',
  '',
  '- **Yeni:** `--durum` bayrağı. Ayrıntı için [kılavuz](docs/KILAVUZ.md).',
  '- İkinci madde',
  '',
  '',
  '- Üçüncü madde',
  '',
  '### 1.3.0 — 2026-10-16',
  '',
  'First public release.',
  '',
  '- **Interface language:** System, Türkçe, English.',
  '',
  '### 1.2.0 — 2026-10-16',
  '- Eski',
].join('\n');

test('çalışan sürümün bölümü bulunur: başlık tarihle, işaretler düz metne çevrilir, bir sonraki başlıkta durur', () => {
  const s = yenilikleriAyikla(ORNEK, '1.4.0');
  assert.equal(s.bulundu, true);
  assert.equal(s.baslik, '1.4.0 — 2026-11-01');
  assert.equal(s.metin, ['• Yeni: --durum bayrağı. Ayrıntı için kılavuz.', '• İkinci madde', '', '• Üçüncü madde'].join('\n'));
  const eski = yenilikleriAyikla(ORNEK, '1.3.0');
  assert.equal(eski.baslik, '1.3.0 — 2026-10-16');
  assert.equal(eski.metin, 'First public release.\n\n• Interface language: System, Türkçe, English.');
  assert.doesNotMatch(eski.metin, /Eski|\*\*|`/);
});

test('sürüm "v" önekli, başlık köşeli parantezli ya da tarihsiz olsa da bulunur; olmayan sürüm ve geçersiz girdi -> bulunamadı', () => {
  assert.equal(yenilikleriAyikla('## [1.5.0] - 2027-01-01\n- x', 'v1.5.0').baslik, '1.5.0 — 2027-01-01');
  assert.deepEqual(yenilikleriAyikla('### 1.5.0\n- x', '1.5.0'), { bulundu: true, baslik: '1.5.0', metin: '• x' });
  const yok = { bulundu: false, baslik: '', metin: '' };
  assert.deepEqual(yenilikleriAyikla(ORNEK, '9.9.9'), yok);
  assert.deepEqual(yenilikleriAyikla(ORNEK, '1.3'), yok);
  assert.deepEqual(yenilikleriAyikla(ORNEK, null), yok);
  assert.deepEqual(yenilikleriAyikla(null, '1.3.0'), yok);
  assert.deepEqual(yenilikleriAyikla('', '1.3.0'), yok);
  assert.deepEqual(yenilikleriAyikla('### 1.3.01 — x\n- y', '1.3.0'), yok, '1.3.01 ile 1.3.0 karışmaz');
});

test('sınırlar: uzun satır kısaltılır, çok satır ve çok karakter "…" ile kesilir', () => {
  const uzun = `### 2.0.0 — d\n- ${'a'.repeat(2000)}`;
  const k = yenilikleriAyikla(uzun, '2.0.0');
  assert.ok(Array.from(k.metin).length <= SINIRLAR.satirSiniri);
  assert.ok(k.metin.endsWith('…'));
  const cok = `### 2.0.0 — d\n${Array.from({ length: 200 }, (_, i) => `- madde ${i}`).join('\n')}`;
  const c = yenilikleriAyikla(cok, '2.0.0');
  assert.equal(c.metin.split('\n').length, SINIRLAR.enCokSatir + 1);
  assert.ok(c.metin.endsWith('\n…'));
  const genis = `### 2.0.0 — d\n${Array.from({ length: 30 }, () => `- ${'b'.repeat(400)}`).join('\n')}`;
  const g = yenilikleriAyikla(genis, '2.0.0');
  assert.ok(g.metin.length <= SINIRLAR.enCokKarakter + 4);
  assert.ok(g.metin.endsWith('…'));
});

test('duzMetin: kalın, kod, bağlantı ve liste imi; HTML etiketi olduğu gibi (renderer textContent ile yazar)', () => {
  assert.equal(duzMetin('- **a** `b` [c](http://x) __d__'), '• a b c d');
  assert.equal(duzMetin('* madde'), '• madde');
  assert.equal(duzMetin('<b>x</b>'), '<b>x</b>');
});

test('gerçek CHANGELOG.md: depodaki en üst sürümün bölümü bulunur ve boş değildir', () => {
  const icerik = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
  const ilk = /^###\s+(\d+\.\d+\.\d+)/m.exec(icerik)[1];
  const s = yenilikleriAyikla(icerik, ilk);
  assert.equal(s.bulundu, true, ilk);
  assert.ok(s.metin.length > 20);
  assert.ok(s.metin.length <= SINIRLAR.enCokKarakter + 4);
});
