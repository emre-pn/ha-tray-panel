'use strict';

/**
 * PC olayı kuralları (o-47, 1.4.0 dis grubu). Saf; Electron'a bağlı değildir.
 * Kural: { olay: 'kilit'|'kilitAcildi'|'uyku'|'uyanis', kimlik: '<favori kimliği>', islem: 'kapat'|'ac'|'calistir'|'geriYukle' }.
 * Varsayılan işlem 'kapat'tır; kapatma dışındaki işlemler ayrıca "açma eylemlerine izin ver" (tetikPcAcma) seçeneğini ister
 * (src/lib/dis-tetik.js). Kimlik Kapı Kuralı'ndan geçmelidir (kapı/kilit kimliği kurala yazılamaz); çalışma anında favori olmayan
 * ya da artık zararsız olmayan kimlik yine kapıda reddedilir.
 */

const { VARLIK_KIMLIGI_DESENI } = require('./dogrulama');
const { alanAl, adGuvenliMi } = require('./suzgec');
const { kayitliAlanMi } = require('./alan-kaydi');

const PC_OLAYLARI = Object.freeze(['kilit', 'kilitAcildi', 'uyku', 'uyanis']);
const PC_ISLEMLERI = Object.freeze(['kapat', 'ac', 'calistir', 'geriYukle']);
const EN_COK_KURAL = 8;
/** Electron powerMonitor olayı -> PC olayı adı. */
const GUC_OLAYLARI = Object.freeze({ 'lock-screen': 'kilit', 'unlock-screen': 'kilitAcildi', suspend: 'uyku', resume: 'uyanis' });
/** Olaydan sonra kuralların çalışmadan önce beklediği süre: uyanışta ağın gelmesi, kilit açılınca oturumun oturması beklenir. */
const OLAY_GECIKMESI_MS = Object.freeze({ kilit: 0, uyku: 0, kilitAcildi: 1500, uyanis: 5000 });

function kimlikGecerliMi(kimlik) {
  return typeof kimlik === 'string' && VARLIK_KIMLIGI_DESENI.test(kimlik) && kayitliAlanMi(alanAl(kimlik)) && adGuvenliMi(kimlik, '');
}

/**
 * Ham kural listesini doğrular: geçersiz öğe sessizce düşer, aynı olay + kimlik bir kez kalır, en çok EN_COK_KURAL kural.
 * Dizi değilse undefined (ayar-alanlari.js: varsayılana düşülür).
 * @param {unknown} ham
 * @returns {{olay: string, kimlik: string, islem: string}[]|undefined}
 */
function pcKurallariDuzelt(ham) {
  if (!Array.isArray(ham)) return undefined;
  const sonuc = [];
  for (const k of ham.slice(0, 50)) {
    if (sonuc.length >= EN_COK_KURAL) break;
    if (!k || typeof k !== 'object' || Array.isArray(k)) continue;
    const islem = k.islem === undefined ? 'kapat' : k.islem;
    if (!PC_OLAYLARI.includes(k.olay) || !PC_ISLEMLERI.includes(islem) || !kimlikGecerliMi(k.kimlik)) continue;
    if (sonuc.some((s) => s.olay === k.olay && s.kimlik === k.kimlik)) continue;
    sonuc.push({ olay: k.olay, kimlik: k.kimlik, islem });
  }
  return sonuc;
}

/** Bir olayın kuralları (doğrulanmış listeden). */
function olayKurallari(kurallar, olay) {
  return (pcKurallariDuzelt(kurallar) ?? []).filter((k) => k.olay === olay);
}

module.exports = { PC_OLAYLARI, PC_ISLEMLERI, EN_COK_KURAL, GUC_OLAYLARI, OLAY_GECIKMESI_MS, kimlikGecerliMi, pcKurallariDuzelt, olayKurallari };
