'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { oturumAcilisiDurumu } = require('../src/lib/oturum-acilisi');

const AD = 'Ev Paneli';
const YOL = 'C:\\Users\\kullanici\\AppData\\Local\\Programs\\Ev Paneli\\Ev Paneli.exe';
const girdi = (ek) => ({ paketli: true, ayarAcik: true, s: { openAtLogin: true }, ad: AD, yol: YOL, ...ek });

test('gelistirme: paketlenmemiş sürüm', () => {
  const d = oturumAcilisiDurumu(girdi({ paketli: false }));
  assert.equal(d.durum, 'gelistirme');
  assert.ok(d.mesaj.length > 10);
});

test('kapali: kullanıcı ayarda kapatmış (Windows durumuna bakılmaz)', () => {
  const d = oturumAcilisiDurumu(girdi({ ayarAcik: false, s: { executableWillLaunchAtLogin: true } }));
  assert.equal(d.durum, 'kapali');
  assert.equal(d.mesaj, '');
});

test('etkin: Windows açılışta çalıştıracak', () => {
  const d = oturumAcilisiDurumu(girdi({ s: { openAtLogin: true, executableWillLaunchAtLogin: true, launchItems: [{ name: AD, path: YOL, enabled: true }] } }));
  assert.equal(d.durum, 'etkin');
});

test('windows-kapatmis: kayıt var ama Görev Yöneticisi/Ayarlar\u2019dan devre dışı', () => {
  const d = oturumAcilisiDurumu(
    girdi({ s: { openAtLogin: true, executableWillLaunchAtLogin: false, launchItems: [{ name: AD, path: YOL, args: ['--gizli'], scope: 'user', enabled: false }] } }),
  );
  assert.equal(d.durum, 'windows-kapatmis');
  assert.match(d.mesaj, /Windows Başlangıç ayarlarından kapatılmış/);
});

test('windows-kapatmis: öğe ad yerine yolla da bulunur (yol büyük/küçük harf ve ayraç farkını yok sayar)', () => {
  const d = oturumAcilisiDurumu(
    girdi({ s: { executableWillLaunchAtLogin: false, launchItems: [{ name: 'Baska Ad', path: YOL.replace(/\\/g, '/').toLowerCase(), enabled: false }] } }),
  );
  assert.equal(d.durum, 'windows-kapatmis');
});

test('kayit-yok: ayar açık ama kayıt defterinde öğe yok', () => {
  for (const s of [{ openAtLogin: false, executableWillLaunchAtLogin: false }, { executableWillLaunchAtLogin: false, launchItems: [] }, { launchItems: [{ name: 'Baska', path: 'C:\\x.exe', enabled: false }] }]) {
    assert.equal(oturumAcilisiDurumu(girdi({ s })).durum, 'kayit-yok', JSON.stringify(s));
  }
});

test('belirsiz: öğe var, devre dışı değil ama Windows "çalışacak" demiyor', () => {
  const d = oturumAcilisiDurumu(girdi({ s: { executableWillLaunchAtLogin: false, launchItems: [{ name: AD, path: YOL }] } }));
  assert.equal(d.durum, 'belirsiz');
});

test('eksik ya da yanlış biçimli s güvenle ele alınır', () => {
  for (const s of [null, undefined, 'metin', 42]) {
    assert.equal(oturumAcilisiDurumu(girdi({ s })).durum, 'belirsiz', String(s));
  }
  assert.equal(oturumAcilisiDurumu(girdi({ s: { launchItems: 'x' } })).durum, 'kayit-yok');
  assert.equal(oturumAcilisiDurumu(girdi({ s: { launchItems: [null, 5, 'x'] } })).durum, 'kayit-yok');
  assert.equal(oturumAcilisiDurumu(girdi({ s: { launchItems: [{ name: AD, enabled: false }] }, yol: undefined })).durum, 'windows-kapatmis');
  assert.equal(oturumAcilisiDurumu(girdi({ s: { launchItems: [{ name: AD, path: 5, enabled: true }] }, yol: undefined })).durum, 'belirsiz');
});

test('tasinabilir (o-45): taşınabilir derlemede durum "tasinabilir" olur; ayar açık olsa da Windows kaydına bakılmaz; iletisi iki dilde vardır', () => {
  const d = oturumAcilisiDurumu(girdi({ tasinabilir: true, s: { executableWillLaunchAtLogin: true, launchItems: [{ name: AD, path: YOL, enabled: true }] } }));
  assert.equal(d.durum, 'tasinabilir');
  assert.match(d.mesaj, /Taşınabilir sürümde Windows ile başlatma yoktur/);
  assert.equal(oturumAcilisiDurumu(girdi({ tasinabilir: true, ayarAcik: false, s: null })).durum, 'tasinabilir');
  assert.equal(oturumAcilisiDurumu(girdi({ tasinabilir: false })).durum, 'kayit-yok', 'taşınabilir değilse eski davranış');
  assert.equal(oturumAcilisiDurumu(girdi({ paketli: false, tasinabilir: true })).durum, 'gelistirme', 'paketlenmemiş sürüm önceliklidir');
  const { cevirmen } = require('../src/lib/dil');
  const en = oturumAcilisiDurumu(girdi({ tasinabilir: true, t: cevirmen('en', require('../src/lib/ceviri/ana')) }));
  assert.match(en.mesaj, /portable version cannot start with Windows/);
});
