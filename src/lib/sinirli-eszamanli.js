'use strict';

/**
 * Sınırlı eşzamanlı çalıştırma (saf): `girdiler` için `isle`yi en çok `sinir` tanesi aynı anda sürecek biçimde çalıştırır,
 * sonuçları girdi sırasında verir. İlk hatada YENİ iş başlatılmaz (sürenler biter); ilk hata fırlatılır.
 *
 * Neden (1.1.1): REST yedeğinde izlenen her varlık için ayrı kimlikli istek atılıyordu (Promise.all, hepsi aynı milisaniyede).
 * Geçersiz anahtarla bu, Home Assistant'ın ip_ban sayacını tek seferde doldurur. Sınırlı eşzamanlılık ve "ilk hatada dur" ile
 * hata/ret durumunda kalan istekler ağa hiç çıkmaz.
 *
 * `ilkTek` (tur 1 inceleme): ilk iş TEK BAŞINA çalışır; başarırsa kalanlar `sinir` kadar paralel başlar, hata verirse HİÇBİRİ
 * başlamaz. Böylece anahtarın o anda geçerli olduğu bilinmiyorsa (iptal edilmiş olabilir) HA'ya giden hatalı deneme en çok 1 olur.
 *
 * @template T, R
 * @param {Iterable<T>} girdiler
 * @param {number} sinir aynı anda en çok kaç iş (en az 1)
 * @param {(girdi: T, sira: number) => Promise<R>} isle
 * @param {{ilkTek?: boolean}} [secenek]
 * @returns {Promise<R[]>}
 */
async function sinirliEszamanli(girdiler, sinir, isle, { ilkTek = false } = {}) {
  const liste = [...girdiler];
  const sonuclar = new Array(liste.length);
  let sonraki = 0;
  let hataVar = false;
  let ilkHata;

  /** Sıradaki işi alıp çalıştırır. false: iş kalmadı ya da hata oldu (devam edilmez). */
  async function birIs() {
    if (hataVar) return false;
    const sira = sonraki;
    sonraki += 1;
    if (sira >= liste.length) return false;
    try {
      sonuclar[sira] = await isle(liste[sira], sira);
      return true;
    } catch (hata) {
      if (!hataVar) {
        hataVar = true;
        ilkHata = hata;
      }
      return false;
    }
  }

  async function isci() {
    while (await birIs());
  }

  const iscilerSayisi = Math.max(1, Math.min(Number.isInteger(sinir) && sinir > 0 ? sinir : 1, liste.length));
  if (ilkTek && liste.length > 1) await birIs(); // ilk iş TEK başına; hata verirse kalanlar hiç başlamaz
  if (!hataVar) await Promise.all(Array.from({ length: iscilerSayisi }, isci));
  if (hataVar) throw ilkHata;
  return sonuclar;
}

module.exports = { sinirliEszamanli };
