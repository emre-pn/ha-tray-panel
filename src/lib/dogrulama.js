'use strict';

/**
 * Saf doğrulama yardımcıları (Electron'a bağlı değildir; birim testleri test/ altındadır).
 */

const VARLIK_KIMLIGI_DESENI = /^[a-z0-9_]+\.[a-z0-9_]+$/;

function kokenAl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** Kullanıcı girdisini "http(s)://host[:port]" köken biçimine getirir; geçersizse null. */
function adresNormallestir(deger, yalnizHttps = false) {
  if (typeof deger !== 'string') return null;
  const metin = deger.trim();
  if (!metin || metin.length > 300) return null;
  try {
    const u = new URL(metin);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (yalnizHttps && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    return u.origin;
  } catch {
    return null;
  }
}

function tamsayi(deger, enAz, enCok, varsayilan) {
  const n = Number(deger);
  if (!Number.isInteger(n) || n < enAz || n > enCok) return varsayilan;
  return n;
}

/**
 * URL'nin normalleştirdiği "a.b.c.d" biçimi: 10/8, 172.16/12, 192.168/16, 127/8 (loopback), 169.254/16 (link-local) ve
 * 1.2.0 (k-19) Tailscale'in kullandığı CGNAT aralığı 100.64.0.0/10 (100.64.0.0 - 100.127.255.255). Yalnız bu aralık eklendi; başka
 * gevşetme yok (ör. *.ts.net adları herkese açık ad sayılmaya devam eder).
 * UYARI: Tailscale trafiği YALNIZ Tailscale ayaktayken şifrelidir. Aralık RFC 6598 paylaşılan adres alanıdır (ISS/mobil erişim
 * noktası CGNAT'ı da kullanır): Tailscale kapalıyken ya da bağlantısı kopukken aynı adres tünel yerine taşıyıcı ağına yönlenebilir ve
 * anahtar düz http ile o yola çıkar. Risk, RFC1918 adreslerin yabancı Wi-Fi'deki durumuyla aynı sınıftadır (anahtar yalnız içerik
 * doğrulamalı, anahtarsız bir manifest yoklamasından sonra gider; yoklama taklit edilebilir). Kök çözüm https adrestir.
 */
function ozelIpv4Mu(ana) {
  const e = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ana);
  if (!e) return null; // IPv4 değil
  const [a, b] = [Number(e[1]), Number(e[2])];
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127) // k-19: Tailscale (CGNAT 100.64.0.0/10)
  );
}

/** IPv6 metnini 8 sayıya açar ("::" kısaltması ve sondaki gömülü IPv4 dahil); çözülemezse null. */
function ipv6Coz(metin) {
  let m = metin;
  const sonIkiNokta = m.lastIndexOf(':');
  if (m.includes('.')) {
    const parcalar = m.slice(sonIkiNokta + 1).split('.').map(Number);
    if (parcalar.length !== 4 || parcalar.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    m = `${m.slice(0, sonIkiNokta + 1)}${((parcalar[0] << 8) | parcalar[1]).toString(16)}:${((parcalar[2] << 8) | parcalar[3]).toString(16)}`;
  }
  const yarilar = m.split('::');
  if (yarilar.length > 2) return null;
  const grup = (t) => (t === '' ? [] : t.split(':'));
  const bas = grup(yarilar[0]);
  const son = yarilar.length === 2 ? grup(yarilar[1]) : [];
  if (yarilar.length === 1 ? bas.length !== 8 : bas.length + son.length > 7) return null;
  const sayilar = [...bas, ...new Array(8 - bas.length - son.length).fill('0'), ...son].map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return sayilar.some(Number.isNaN) ? null : sayilar;
}

function ozelIpv6Mu(ana) {
  const g = ipv6Coz(ana);
  if (!g) return false;
  if (g.slice(0, 7).every((n) => n === 0) && g[7] === 1) return true; // ::1
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 benzersiz yerel
  if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) {
    return ozelIpv4Mu(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`) === true; // ::ffff:a.b.c.d
  }
  return false;
}

/**
 * Ana bilgisayar adı yalnız ev/yerel ağda çözülebilir mi: loopback, özel IP (RFC1918, link-local, Tailscale 100.64/10, fc00::/7), "localhost",
 * .local / .lan / .home.arpa / .localhost uzantıları ya da noktasız tek etiketli ad ("homeassistant"). Herkese açık
 * (internet) adlar ve adresler için false.
 * @param {string} anaBilgisayar URL'nin `hostname` değeri (köşeli ayraçlı IPv6 olabilir)
 */
function ozelAgAdiMi(anaBilgisayar) {
  if (typeof anaBilgisayar !== 'string' || anaBilgisayar === '') return false;
  let ana = anaBilgisayar.toLowerCase();
  if (ana.startsWith('[') && ana.endsWith(']')) return ozelIpv6Mu(ana.slice(1, -1));
  if (ana.endsWith('.')) ana = ana.slice(0, -1);
  if (ana === '') return false;
  const ipv4 = ozelIpv4Mu(ana);
  if (ipv4 !== null) return ipv4;
  if (/^[0-9.]+$/.test(ana)) return false; // rakam ve noktadan oluşan ama geçerli IPv4 olmayan (URL normalleştirmediyse) biçim
  if (!ana.includes('.')) return true; // tek etiket: yalnız yerel ad çözümüyle bulunur
  return ['.localhost', '.local', '.lan', '.home.arpa'].some((uzanti) => ana.endsWith(uzanti));
}

/**
 * Erişim anahtarı bu kökene gönderilebilir mi (hata-01 savunma derinliği): https her zaman; http yalnız ev/yerel ağ adresinde.
 * Herkese açık bir ana bilgisayara düz http ile anahtar gitmez.
 * @param {string} adres "http(s)://host[:port]"
 */
function anahtarIcinGuvenliAdresMi(adres) {
  try {
    const u = new URL(adres);
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && ozelAgAdiMi(u.hostname);
  } catch {
    return false;
  }
}

module.exports = { VARLIK_KIMLIGI_DESENI, kokenAl, adresNormallestir, tamsayi, ozelAgAdiMi, anahtarIcinGuvenliAdresMi };
