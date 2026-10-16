'use strict';

/**
 * Arayüz dili: uçtan uca "t() kullanılmayan Türkçe dize" bekçisi.
 *
 * src/ altındaki her .js dosyasında (yorumlar hariç) Türkçe harf içeren dize sabitleri bulunur. Kullanıcıya görünen metin
 * sözlükten (src/lib/ceviri/*.js) gelmelidir; bu yüzden Türkçe harfli sabit yalnız şu yerlerde kalabilir:
 *   1. Günlük çağrılarının içinde (gunluk, gunlugeYaz, gunlukKaydi.yaz): günlük satırları çevrilmez.
 *   2. Aşağıdaki izin listesinde: sözlükteki Türkçe metinle birebir aynı olduğu başka testlerle sınanan varsayılanlar
 *      (t verilmediğinde kullanılan Türkçe geri dönüşler) ve yalnız günlüğe giden sabitler.
 * Yeni bir Türkçe sabit eklenirse bu test kırılır: metin sözlüğe taşınmalı (t('anahtar')) ya da nedeniyle izin listesine yazılmalıdır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const KOK = path.join(__dirname, '..');
const TURKCE_HARF = /[çğıöşüÇĞİÖŞÜ]/;
const GUNLUK_CAGRILARI = new Set(['gunluk', 'gunlugeYaz', 'yaz']);

/**
 * İzin listesi: dosya -> yalnız o dosyada Türkçe harfli kalabilen "grup" açıklamaları ve metinleri.
 * 'tumu: true' dosyadaki bütün Türkçe sabitlere izin verir (hepsi sözlükteki tr metinlerle birebir aynı varsayılanlardır).
 */
const IZINLI = {
  // Panel grup etiketleri ve hazır karo etiketleri: main.js bunları sözlükten ('grup.*', 'hazir.*') alır; buradakiler Türkçe varsayılandır
  // (test/dil.test.js: hazir.<kimlik> ve grup.<kod> aileleri, etiketlerin sözlükteki tr metinle aynı olması).
  'src/lib/favoriler.js': { tumu: true },
  // Alan etiketleri: main.js 'alan.<alan>' sözlük anahtarıyla gönderir; buradakiler Türkçe varsayılandır.
  'src/lib/suzgec.js': { tumu: true },
  // Kısayol iletileri ve Windows'a ayrılmış birleşim adları: t verilmezse kullanılan Türkçe varsayılanlar
  // (test/dil.test.js: "kisayol.js'teki satır içi Türkçe varsayılan iletiler sözlükteki tr metinlerle aynı").
  'src/lib/kisayol.js': { tumu: true },
  // Yalnız günlüğe giden sabitler.
  'src/lib/bildirim-metni.js': { metinler: ['Ev içi adres http; erişim anahtarı ağda şifresiz gidiyor.'] },
  'src/ha-istemcisi.js': { metinler: ['ev içi adres', 'dış adres'] }, // adresEtiketi: yetkiKesici.duraklat günlük satırı
  // Masaüstü karosu yöneticisi (o-33): guvenli(is, mesaj) yardımcısının mesaj bağımsız değişkeni yalnız günlüğe gider (kullanıcıya görünmez).
  'src/masaustu-karolari.js': {
    metinler: [
      'Masaüstü karoları belirlenemedi.',
      'Masaüstü karosu modeli alınamadı.',
      'Masaüstü karosu malzemesi okunamadı.',
      'Masaüstü karosu modeli gönderilemedi.',
      'Masaüstü karosu konumu okunamadı.',
      'Masaüstü karosu konumu kaydedilemedi.',
      'Masaüstü karosu penceresi kapatılamadı.',
      'Ekranlar okunamadı.',
      'Masaüstü karosu gösterilemedi.',
      'Masaüstü karosu kaldırılamadı.',
      'Masaüstü karosu üst durumu okunamadı.',
      'Masaüstü karosu üst durumu uygulanamadı.',
      'Masaüstü karosu dili güncellenemedi.',
      'Masaüstü karosu yeniden yerleştirilemedi.',
    ],
  },
};

/** Dize sabitlerini ve her birinin içinde bulunduğu çağrı adlarını çıkarır (yorumlar atlanır). */
function dizeleriBul(kaynak) {
  const dizeler = [];
  const n = kaynak.length;
  let i = 0;
  let satir = 1;
  let onceki = ''; // son anlamlı karakter ('a': tanımlayıcı, '0': sayı, '"': dize ya da regex): bölme / regex ayrımı için
  let sonKelime = '';
  const parantezler = []; // açık '(' çağrılarının adları
  const sablonYigini = []; // şablon içi ${ ... } için süslü parantez derinlikleri
  let suslu = 0;
  const regexOncesiKelimeler = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do']);

  const kacisOku = () => {
    const c = kaynak[i + 1];
    if (c === 'u') {
      if (kaynak[i + 2] === '{') {
        const j = kaynak.indexOf('}', i);
        const s = String.fromCodePoint(parseInt(kaynak.slice(i + 3, j), 16));
        i = j + 1;
        return s;
      }
      const s = String.fromCharCode(parseInt(kaynak.slice(i + 2, i + 6), 16));
      i += 6;
      return s;
    }
    if (c === 'x') {
      const s = String.fromCharCode(parseInt(kaynak.slice(i + 2, i + 4), 16));
      i += 4;
      return s;
    }
    if (c === '\n') satir += 1;
    i += 2;
    return { n: '\n', t: '\t', r: '\r', 0: '\0' }[c] ?? c;
  };
  const ekle = (satirNo, metin) => dizeler.push({ satir: satirNo, metin, cagrilar: [...parantezler] });

  const dizeOku = (tirnak) => {
    const bas = satir;
    let s = '';
    i += 1;
    while (i < n && kaynak[i] !== tirnak) {
      if (kaynak[i] === '\\') s += kacisOku();
      else {
        if (kaynak[i] === '\n') satir += 1;
        s += kaynak[i++];
      }
    }
    i += 1;
    ekle(bas, s);
    onceki = '"';
  };
  // Şablonun bir parçasını okur (açılış ` ya da ${...} kapanışı sonrası); ${ görürse ifade moduna geçer.
  const sablonParcasiOku = () => {
    const bas = satir;
    let s = '';
    i += 1;
    while (i < n) {
      const c = kaynak[i];
      if (c === '\\') {
        s += kacisOku();
        continue;
      }
      if (c === '`') {
        i += 1;
        ekle(bas, s);
        onceki = '"';
        return;
      }
      if (c === '$' && kaynak[i + 1] === '{') {
        ekle(bas, s);
        i += 2;
        sablonYigini.push(suslu);
        suslu = 0;
        onceki = '{';
        return;
      }
      if (c === '\n') satir += 1;
      s += c;
      i += 1;
    }
  };

  while (i < n) {
    const c = kaynak[i];
    if (c === '\n') {
      satir += 1;
      i += 1;
    } else if (c === ' ' || c === '\t' || c === '\r') {
      i += 1;
    } else if (c === '/' && kaynak[i + 1] === '/') {
      while (i < n && kaynak[i] !== '\n') i += 1;
    } else if (c === '/' && kaynak[i + 1] === '*') {
      const son = kaynak.indexOf('*/', i + 2);
      satir += (kaynak.slice(i, son + 2).match(/\n/g) || []).length;
      i = son + 2;
    } else if (c === '"' || c === "'") {
      dizeOku(c);
    } else if (c === '`') {
      sablonParcasiOku();
    } else if (c === '{') {
      suslu += 1;
      onceki = c;
      i += 1;
    } else if (c === '}') {
      if (sablonYigini.length > 0 && suslu === 0) {
        suslu = sablonYigini.pop();
        sablonParcasiOku(); // '}' şablonun devamının "açılışı" gibi okunur (sablonParcasiOku ilk karakteri atlar)
      } else {
        suslu -= 1;
        onceki = c;
        i += 1;
      }
    } else if (c === '(') {
      parantezler.push(onceki === 'a' ? sonKelime : '');
      onceki = c;
      sonKelime = '';
      i += 1;
    } else if (c === ')') {
      parantezler.pop();
      onceki = c;
      sonKelime = '';
      i += 1;
    } else if (c === '/') {
      const regexMi = onceki === '' || '(,=:[!&|?{};+-*%<>~^'.includes(onceki) || regexOncesiKelimeler.has(sonKelime);
      if (regexMi) {
        i += 1;
        let sinif = false;
        while (i < n) {
          const d = kaynak[i];
          if (d === '\\') {
            i += 2;
            continue;
          }
          if (d === '[') sinif = true;
          else if (d === ']') sinif = false;
          else if (d === '/' && !sinif) break;
          i += 1;
        }
        i += 1;
        while (/[a-z]/i.test(kaynak[i] ?? '')) i += 1;
        onceki = '"';
      } else {
        onceki = c;
        i += 1;
      }
    } else if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(kaynak[j])) j += 1;
      sonKelime = kaynak.slice(i, j);
      onceki = 'a';
      i = j;
    } else if (/[0-9]/.test(c)) {
      let j = i;
      while (j < n && /[0-9a-zA-Z_.]/.test(kaynak[j])) j += 1;
      i = j;
      onceki = '0';
      sonKelime = '';
    } else {
      onceki = c;
      sonKelime = '';
      i += 1;
    }
  }
  return { dizeler, dengeli: parantezler.length === 0 && sablonYigini.length === 0 && suslu === 0 };
}

function jsDosyalari(dizin, sonuc = []) {
  for (const girdi of fs.readdirSync(dizin, { withFileTypes: true })) {
    const tam = path.join(dizin, girdi.name);
    if (girdi.isDirectory()) {
      if (girdi.name !== 'ceviri') jsDosyalari(tam, sonuc); // sözlükler (src/lib/ceviri) zaten Türkçe metin taşır
    } else if (girdi.name.endsWith('.js')) sonuc.push(tam);
  }
  return sonuc;
}

const goreli = (dosya) => path.relative(KOK, dosya).split(path.sep).join('/');

test('bekçi çözümleyicisi: dize, şablon, yorum ve çağrı adlarını doğru ayırır (kendi kendini sınar)', () => {
  const kaynak = [
    "const a = 'Işık'; // 'yorumdaki Ğ' sayılmaz",
    '/* "blok yorumu Ş" */',
    'const r = /[çğ]\\/x/.test(a);',
    'gunluk(`Sayfa süreci ${f(x) + 1} kapandı (${y})`);',
    "bildir(t('anahtar'), 'Başlık');",
    'const b = olay.a / 2 / olay.b;',
  ].join('\n');
  const { dizeler, dengeli } = dizeleriBul(kaynak);
  assert.equal(dengeli, true);
  assert.deepEqual(
    dizeler.map((d) => [d.satir, d.metin, d.cagrilar.at(-1) ?? null]),
    [
      [1, 'Işık', null],
      [4, 'Sayfa süreci ', 'gunluk'],
      [4, ' kapandı (', 'gunluk'],
      [4, ')', 'gunluk'],
      [5, 'anahtar', 't'],
      [5, 'Başlık', 'bildir'],
    ],
  );
});

test('src/: Türkçe harfli dize sabiti yalnız günlük çağrılarında ya da gerekçeli izin listesinde bulunur (görünür metin sözlükten gelir)', () => {
  const kacaklar = [];
  let taranan = 0;
  for (const dosya of jsDosyalari(path.join(KOK, 'src'))) {
    const ad = goreli(dosya);
    const { dizeler, dengeli } = dizeleriBul(fs.readFileSync(dosya, 'utf8'));
    assert.equal(dengeli, true, `${ad}: çözümleyici dengesiz bitti (söz dizimi ya da regex algılama sorunu)`);
    taranan += 1;
    const izin = IZINLI[ad];
    for (const d of dizeler) {
      if (!TURKCE_HARF.test(d.metin)) continue;
      if (d.cagrilar.some((c) => GUNLUK_CAGRILARI.has(c))) continue; // günlük satırı: çevrilmez
      if (izin?.tumu) continue;
      if (izin?.metinler?.includes(d.metin)) continue;
      kacaklar.push(`${ad}:${d.satir}: ${JSON.stringify(d.metin)}`);
    }
  }
  assert.ok(taranan > 40, `src/ altında yeterli dosya taranmadı (${taranan})`);
  assert.deepEqual(kacaklar, [], 'Bu Türkçe metinler sözlüğe taşınmalı (t("anahtar")) ya da nedeniyle izin listesine eklenmeli');
});

test('izin listesi güncel: listedeki her dosya var ve gerçekten Türkçe harfli (günlük dışı) sabit içeriyor; "metinler" girdileri kaynakta duruyor', () => {
  for (const [ad, izin] of Object.entries(IZINLI)) {
    const dosya = path.join(KOK, ad);
    assert.ok(fs.existsSync(dosya), `${ad} yok`);
    const { dizeler } = dizeleriBul(fs.readFileSync(dosya, 'utf8'));
    const turkceler = dizeler.filter((d) => TURKCE_HARF.test(d.metin) && !d.cagrilar.some((c) => GUNLUK_CAGRILARI.has(c)));
    assert.ok(turkceler.length > 0, `${ad}: izin gereksiz (günlük dışı Türkçe sabit kalmamış)`);
    for (const metin of izin.metinler ?? []) assert.ok(turkceler.some((d) => d.metin === metin) || dizeler.some((d) => d.metin === metin), `${ad}: izinli metin kaynakta yok: ${metin}`);
  }
});
