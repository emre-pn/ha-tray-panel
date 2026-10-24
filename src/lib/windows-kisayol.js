'use strict';

/**
 * Jump List görevleri ve masaüstü kısayolu (o-21, 1.4.0 dis grubu) için saf yardımcılar; Electron'a bağlı değildir.
 * Görevler ve .lnk dosyaları `--eylem="<favori adı>" --kaynak=jumplist|kisayol` ile uygulamayı açar; eylem o zaman dış tetik kapısından
 * (src/lib/dis-tetik.js) geçer: seçenek kapalıysa, favori artık zararsız değilse ya da ad başka karoya kaymışsa HİÇBİR şey çalışmaz.
 */

const { eylemArgumanlari } = require('./komut-satiri');

const JUMP_LIST_SINIRI = 10;
const DOSYA_ADI_SINIRI = 60;
const AYRILMIS_ADLAR = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;

/**
 * Windows dosya adı: yasak karakterler (< > : " / \ | ? * ve denetim) boşluğa çevrilir, boşluklar sadeleşir, sondaki nokta ve
 * boşluk atılır; ayrılmış adlara (CON, NUL...) ilk noktadan önceki parçanın sonuna alt çizgi eklenir (nul.txt -> nul_.txt). Boş kalırsa null.
 * @param {unknown} ad
 */
function dosyaAdiDuzelt(ad) {
  if (typeof ad !== 'string') return null;
  let m = ad
    .replace(/[<>:"/\\|?*\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  m = [...m].slice(0, DOSYA_ADI_SINIRI).join('');
  m = m.replace(/[. ]+$/, '');
  if (m === '') return null;
  // Windows ilk noktadan ÖNCEKİ parçası ayrılmış olan her adı (uzantı olsa da, nokta öncesi boşluk olsa da) aygıt adı sayar:
  // "nul.txt", "Con. Salon", "NUL .txt". Alt çizgi bu parçanın sonuna eklenir ("nul_.txt"); adın sonuna eklemek adı ayrılmış bırakırdı.
  if (AYRILMIS_ADLAR.test(m.split('.')[0].trimEnd())) {
    m = m.replace(/^[^.]*/, (parca) => `${parca.trimEnd()}_`);
    m = [...m].slice(0, DOSYA_ADI_SINIRI).join('').replace(/[. ]+$/, ''); // ek karakter sınırı aşmasın
  }
  return m;
}

/**
 * Klasörde kullanılmayan .lnk adı: "Ad.lnk", "Ad (2).lnk" ... "Ad (20).lnk"; hepsi doluysa null. Var olan dosyanın ÜZERİNE YAZILMAZ.
 * @param {string} ad dosyaAdiDuzelt sonucu
 * @param {(dosyaAdi: string) => boolean} varMi
 */
function bosKisayolAdi(ad, varMi) {
  if (typeof ad !== 'string' || ad === '') return null;
  for (let i = 1; i <= 20; i += 1) {
    const aday = i === 1 ? `${ad}.lnk` : `${ad} (${i}).lnk`;
    if (!varMi(aday)) return aday;
  }
  return null;
}

/** Komut satırı argümanını tırnaklar (geliştirme modundaki uygulama yolu için; yol tırnak içeremez). */
function tirnakla(arguman) {
  return `"${String(arguman).replace(/"/g, '')}"`;
}

/**
 * Jump List planı: { type: 'tasks', items } ya da görev yoksa null (Electron app.setJumpList(null) varsayılan listeye döner).
 * @param {object} girdi
 * @param {{karo: {etiket: string}, ad: string}[]} girdi.uygunlar dis-tetik.js uygunlar() (sıra korunur)
 * @param {string} girdi.program çalıştırılabilir dosya
 * @param {string[]} [girdi.onekArgumanlar] geliştirme modunda uygulama yolu
 * @param {(ad: string) => string} [girdi.aciklama] görevin açıklaması (ipucu)
 * @param {number} [girdi.enCok]
 */
function jumpListPlani({ uygunlar, program, onekArgumanlar = [], aciklama = (ad) => ad, enCok = JUMP_LIST_SINIRI }) {
  if (!Array.isArray(uygunlar) || typeof program !== 'string' || program === '') return null;
  const onek = onekArgumanlar.map(tirnakla).join(' ');
  const items = [];
  for (const { karo, ad } of uygunlar) {
    if (items.length >= enCok) break;
    const args = eylemArgumanlari(ad, 'jumplist');
    if (!args) continue;
    const baslik = typeof karo?.etiket === 'string' && karo.etiket.trim() ? karo.etiket.trim() : ad;
    items.push({
      type: 'task',
      title: [...baslik].slice(0, 60).join(''),
      description: aciklama(baslik),
      program,
      args: onek ? `${onek} ${args}` : args,
      iconPath: program,
      iconIndex: 0,
    });
  }
  return items.length > 0 ? [{ type: 'tasks', items }] : null;
}

/** Jump List planının karşılaştırma imzası (aynı plan yeniden yazılmasın). */
function planImzasi(plan) {
  return JSON.stringify(plan ?? null);
}

/**
 * Masaüstü kısayolu seçenekleri (Electron shell.writeShortcutLink 'create'). Ad güvenli değilse null.
 * @param {{ad: string, program: string, onekArgumanlar?: string[], aciklama?: string}} girdi
 */
function kisayolSecenekleri({ ad, program, onekArgumanlar = [], aciklama = '' }) {
  const args = eylemArgumanlari(ad, 'kisayol');
  if (!args || typeof program !== 'string' || program === '') return null;
  const onek = onekArgumanlar.map(tirnakla).join(' ');
  return { target: program, args: onek ? `${onek} ${args}` : args, description: aciklama, icon: program, iconIndex: 0 };
}

module.exports = { JUMP_LIST_SINIRI, dosyaAdiDuzelt, bosKisayolAdi, jumpListPlani, planImzasi, kisayolSecenekleri };
