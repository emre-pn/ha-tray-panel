'use strict';

/**
 * Testler için küçük DOM: gerçek bir HTML dosyasını (src/*.html) ağaca çevirir. Tarayıcı, Electron ya da jsdom YOK; yalnız arayüz
 * betiklerinin ihtiyaç duyduğu kadarı vardır: childNodes / children / parentNode, classList, getAttribute, textContent,
 * querySelectorAll / querySelector / getElementById / closest (basit seçiciler: tag, .sinif, #kimlik, [nitelik], bunların birleşimi ve virgül listesi).
 * Stil/yerleşim yoktur; "görünür mü" sorusu sınıflarla (örn. arama-gizli) ve `open` özelliğiyle sınanır.
 */

const BOS_ETIKETLER = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const HAM_METIN_ETIKETLERI = new Set(['script', 'style']);
const VARLIKLAR = { gt: '>', lt: '<', amp: '&', quot: '"', apos: "'", nbsp: ' ', uuml: 'ü', ccedil: 'ç', ouml: 'ö', Uuml: 'Ü', Ccedil: 'Ç', Ouml: 'Ö' };

function varlikCoz(metin) {
  return metin.replace(/&(#x[0-9a-f]+|#\d+|[a-zA-Z]+);/g, (tam, ad) => {
    if (ad[0] === '#') return String.fromCodePoint(ad[1] === 'x' ? parseInt(ad.slice(2), 16) : parseInt(ad.slice(1), 10));
    return Object.hasOwn(VARLIKLAR, ad) ? VARLIKLAR[ad] : tam;
  });
}

class MiniOge {
  constructor(etiket, nitelikler = {}) {
    this.nodeType = 1;
    this.tagName = etiket.toUpperCase();
    this.attributes = { ...nitelikler };
    this.childNodes = [];
    this.parentNode = null;
    this.open = Object.hasOwn(nitelikler, 'open');
    const oge = this;
    const sinifListesi = () => String(oge.attributes.class ?? '').split(/\s+/).filter(Boolean);
    this.classList = {
      add: (c) => {
        if (!sinifListesi().includes(c)) oge.attributes.class = [...sinifListesi(), c].join(' ');
      },
      remove: (c) => {
        oge.attributes.class = sinifListesi().filter((p) => p !== c).join(' ');
      },
      contains: (c) => sinifListesi().includes(c),
    };
  }

  get id() {
    return this.attributes.id ?? '';
  }

  get children() {
    return this.childNodes.filter((d) => d.nodeType === 1);
  }

  get textContent() {
    return this.childNodes.map((d) => (d.nodeType === 3 ? d.textContent : HAM_METIN_ETIKETLERI.has(d.tagName.toLowerCase()) ? '' : d.textContent)).join('');
  }

  getAttribute(ad) {
    return Object.hasOwn(this.attributes, ad) ? String(this.attributes[ad]) : null;
  }

  hasAttribute(ad) {
    return Object.hasOwn(this.attributes, ad);
  }

  setAttribute(ad, deger) {
    this.attributes[ad] = String(deger);
  }

  *ogeler() {
    for (const c of this.children) {
      yield c;
      yield* c.ogeler();
    }
  }

  uyar(secici) {
    return seciciListesi(secici).some((parcalar) => parcalar.every((p) => parcaUyar(this, p)));
  }

  querySelectorAll(secici) {
    const sonuc = [];
    for (const o of this.ogeler()) if (o.uyar(secici)) sonuc.push(o);
    return sonuc;
  }

  querySelector(secici) {
    return this.querySelectorAll(secici)[0] ?? null;
  }

  closest(secici) {
    for (let o = this; o && o.nodeType === 1; o = o.parentNode) if (o.uyar(secici)) return o;
    return null;
  }

  contains(oge) {
    for (let o = oge; o; o = o.parentNode) if (o === this) return true;
    return false;
  }

  scrollIntoView() {
    this.kaydirma = (this.kaydirma ?? 0) + 1;
  }
}

class MiniMetin {
  constructor(metin) {
    this.nodeType = 3;
    this.textContent = metin;
    this.parentNode = null;
  }
}

/** "a.b#c, d[e]" -> [[{etiket, sinif[], kimlik, nitelik[]}], ...] */
function seciciListesi(secici) {
  return String(secici).split(',').map((s) => {
    const m = s.trim();
    const parca = { etiket: null, sinif: [], kimlik: null, nitelik: [] };
    for (const e of m.matchAll(/([.#]?)([A-Za-z_][\w-]*)|\[([\w-]+)\]/g)) {
      if (e[3]) parca.nitelik.push(e[3]);
      else if (e[1] === '.') parca.sinif.push(e[2]);
      else if (e[1] === '#') parca.kimlik = e[2];
      else parca.etiket = e[2].toLowerCase();
    }
    return [parca];
  });
}

function parcaUyar(oge, p) {
  if (p.etiket && oge.tagName.toLowerCase() !== p.etiket) return false;
  if (p.kimlik && oge.id !== p.kimlik) return false;
  if (!p.sinif.every((c) => oge.classList.contains(c))) return false;
  return p.nitelik.every((n) => oge.hasAttribute(n));
}

function nitelikleriCoz(metin) {
  const sonuc = {};
  for (const m of metin.matchAll(/([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    sonuc[m[1]] = varlikCoz(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return sonuc;
}

/** HTML metnini { documentElement, body, querySelectorAll, getElementById... } ağacına çevirir. */
function htmlAgaci(html) {
  const kok = new MiniOge('#belge');
  let simdiki = kok;
  const etiketRe = /<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|<\/([A-Za-z][\w-]*)\s*>|<([A-Za-z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/gy;
  let son = 0;
  const metinEkle = (m) => {
    if (m === '') return;
    const d = new MiniMetin(varlikCoz(m));
    d.parentNode = simdiki;
    simdiki.childNodes.push(d);
  };
  while (son < html.length) {
    etiketRe.lastIndex = son;
    const sonraki = html.indexOf('<', son);
    if (sonraki === -1) {
      metinEkle(html.slice(son));
      break;
    }
    if (sonraki > son) {
      metinEkle(html.slice(son, sonraki));
      son = sonraki;
    }
    etiketRe.lastIndex = son;
    const e = etiketRe.exec(html);
    if (!e) {
      metinEkle('<');
      son += 1;
      continue;
    }
    son = etiketRe.lastIndex;
    if (e[0].startsWith('<!')) continue;
    if (e[1]) {
      const ad = e[1].toLowerCase();
      let o = simdiki;
      while (o && o.nodeType === 1 && o.tagName.toLowerCase() !== ad) o = o.parentNode;
      if (o && o !== kok) simdiki = o.parentNode;
      continue;
    }
    const ad = e[2].toLowerCase();
    const oge = new MiniOge(ad, nitelikleriCoz(e[3]));
    oge.parentNode = simdiki;
    simdiki.childNodes.push(oge);
    if (HAM_METIN_ETIKETLERI.has(ad)) {
      const bitis = html.toLowerCase().indexOf(`</${ad}`, son);
      const ham = html.slice(son, bitis === -1 ? html.length : bitis);
      const t = new MiniMetin(ham);
      t.parentNode = oge;
      oge.childNodes.push(t);
      son = bitis === -1 ? html.length : html.indexOf('>', bitis) + 1;
      continue;
    }
    if (!BOS_ETIKETLER.has(ad) && e[4] !== '/') simdiki = oge;
  }
  return {
    kok,
    body: kok.querySelector('body'),
    querySelectorAll: (s) => kok.querySelectorAll(s),
    querySelector: (s) => kok.querySelector(s),
    getElementById: (k) => kok.querySelector(`#${k}`),
  };
}

module.exports = { htmlAgaci, MiniOge };
