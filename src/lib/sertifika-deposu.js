'use strict';

/**
 * Sertifika güveni kaydı (1.4.0, o-56): kullanıcının eklediği özel kök CA'lar ve ana bilgisayara bağlı parmak izi sabitlemeleri.
 * Dosya: <userData>\sertifika-guveni.json. Ayar dosyasına, dışa aktarmaya, klasör eşitlemesine ve yedeğe GİRMEZ: içe aktarılan ya da
 * eşitlenen bir dosya güven köklerini değiştiremesin. İçerik genel sertifikalardır (sır değil); yine de günlüğe yazılmaz.
 *
 * Yükleme sırasında her kayıt yeniden doğrulanır (PEM'den parmak izi yeniden hesaplanır): dosya elle bozulsa bile yalnız geçerli, süresi
 * içindeki kök CA'lar ve 64 haneli parmak izleri etkin olur. `fs` dışarıdan verilir (testlerde gerçek geçici klasör ya da sahte).
 */

const { EN_COK_CA, EN_COK_SABIT, anaBilgisayarCoz, kokBilgisi } = require('./sertifika');

const SURUM = 1;

/**
 * @param {object} bag
 * @param {string} bag.dosyaYolu
 * @param {{ readFileSync: Function, promises: { writeFile: Function, rename: Function, rm: Function } }} bag.fs
 * @param {(mesaj: string) => void} [bag.gunluk] yalnız sabit metinler
 * @param {() => number} [bag.simdi]
 * @param {object} [bag.sertifikaSecenekleri] testler için (X509Certificate)
 */
function sertifikaDeposuOlustur({ dosyaYolu, fs, gunluk = () => {}, simdi = Date.now, sertifikaSecenekleri = {} }) {
  let kokler = []; // { parmak, ad, pem, baslangic, bitis }
  let sabitler = []; // { anaBilgisayar, parmak, eklendi }
  let yuklendi = false;
  let yuklemeSozu = null;
  let yazmaSirasi = Promise.resolve();
  const dinleyiciler = new Set();

  const bildir = () => {
    for (const f of [...dinleyiciler]) {
      try {
        f();
      } catch {
        // dinleyici hatası kaydı bozmaz
      }
    }
  };

  function belgedenKur(belge) {
    const yeniKokler = [];
    const yeniSabitler = [];
    const kokListesi = Array.isArray(belge?.ca) ? belge.ca : [];
    for (const k of kokListesi.slice(0, EN_COK_CA)) {
      if (!k || typeof k.pem !== 'string') continue;
      const bilgi = kokBilgisi(k.pem, { simdi: simdi(), ...sertifikaSecenekleri });
      if (bilgi.ok && !yeniKokler.some((x) => x.parmak === bilgi.parmak)) {
        yeniKokler.push({ parmak: bilgi.parmak, ad: bilgi.ad, pem: bilgi.pem, baslangic: bilgi.baslangic, bitis: bilgi.bitis });
      }
    }
    const sabitListesi = Array.isArray(belge?.sabit) ? belge.sabit : [];
    for (const s of sabitListesi.slice(0, EN_COK_SABIT)) {
      const anaBilgisayar = anaBilgisayarCoz(s?.anaBilgisayar);
      const parmak = typeof s?.parmak === 'string' && /^[0-9a-f]{64}$/.test(s.parmak) ? s.parmak : null;
      if (anaBilgisayar && parmak && !yeniSabitler.some((x) => x.anaBilgisayar === anaBilgisayar)) {
        yeniSabitler.push({ anaBilgisayar, parmak, eklendi: typeof s.eklendi === 'string' ? s.eklendi.slice(0, 40) : '' });
      }
    }
    kokler = yeniKokler;
    sabitler = yeniSabitler;
  }

  /**
   * Kaydı okur. Dosya küçüktür (birkaç genel sertifika) ve açılışta bir kez okunur: eşzamanlı okuma, yükleme çağrısı döner dönmez
   * kayıtların hazır olmasını sağlar; böylece ilk canlı bağlantı/HA penceresi isteği kayıt bilinmeden başlamaz (yarış yok).
   */
  function yukle() {
    if (!yuklemeSozu) {
      try {
        belgedenKur(JSON.parse(fs.readFileSync(dosyaYolu, 'utf8')));
      } catch (hata) {
        kokler = [];
        sabitler = [];
        if (hata && hata.code !== 'ENOENT') gunluk('Sertifika güveni dosyası okunamadı; kayıt boş sayıldı.');
      }
      yuklendi = true;
      yuklemeSozu = Promise.resolve();
      bildir();
    }
    return yuklemeSozu;
  }

  const hazir = () => yuklemeSozu ?? yukle();
  const hazirMi = () => yuklendi;

  function belge() {
    return { surum: SURUM, ca: kokler.map((k) => ({ ...k })), sabit: sabitler.map((s) => ({ ...s })) };
  }

  /** Yazmalar sıraya girer; kayıt atomik (geçici dosya + yeniden adlandırma). Başarısızlıkta bellek durumu eski haline döner. */
  function yaz(oncekiKokler, oncekiSabitler) {
    const gonderilen = JSON.stringify(belge());
    const is = yazmaSirasi.then(async () => {
      const gecici = `${dosyaYolu}.tmp`;
      try {
        await fs.promises.writeFile(gecici, gonderilen, 'utf8');
        await fs.promises.rename(gecici, dosyaYolu);
        return { ok: true };
      } catch {
        kokler = oncekiKokler;
        sabitler = oncekiSabitler;
        try {
          await fs.promises.rm(gecici, { force: true });
        } catch {
          // temizlik en iyi çabadır
        }
        gunluk('Sertifika güveni dosyası yazılamadı; değişiklik geri alındı.');
        return { ok: false, neden: 'yazilamadi' };
      }
    });
    yazmaSirasi = is.catch(() => {});
    return is;
  }

  async function degistir(uygula) {
    await hazir();
    const oncekiKokler = kokler;
    const oncekiSabitler = sabitler;
    const sonuc = uygula();
    if (!sonuc.ok) return sonuc;
    const yazildi = await yaz(oncekiKokler, oncekiSabitler);
    if (!yazildi.ok) return yazildi;
    bildir();
    return sonuc;
  }

  /** Doğrulanmış kök CA bilgilerini ekler (kokBilgisi çıktısı). Aynı parmak izi tekrar eklenmez. */
  function kokEkle(bilgiler) {
    return degistir(() => {
      const yeni = [...kokler];
      for (const b of bilgiler) {
        if (!yeni.some((k) => k.parmak === b.parmak)) yeni.push({ parmak: b.parmak, ad: b.ad, pem: b.pem, baslangic: b.baslangic, bitis: b.bitis });
      }
      if (yeni.length > EN_COK_CA) return { ok: false, neden: 'cok-fazla' };
      const eklenen = yeni.length - kokler.length;
      kokler = yeni;
      return { ok: true, eklenen };
    });
  }

  function kokSil(parmak) {
    return degistir(() => {
      const kalan = kokler.filter((k) => k.parmak !== parmak);
      if (kalan.length === kokler.length) return { ok: false, neden: 'yok' };
      kokler = kalan;
      return { ok: true };
    });
  }

  /** Ana bilgisayara bağlı parmak izi sabitler (aynı ana bilgisayarda öncekinin yerine geçer). */
  function sabitle(anaBilgisayarGirdisi, parmak) {
    return degistir(() => {
      const anaBilgisayar = anaBilgisayarCoz(anaBilgisayarGirdisi);
      if (!anaBilgisayar) return { ok: false, neden: 'ad-gecersiz' };
      if (typeof parmak !== 'string' || !/^[0-9a-f]{64}$/.test(parmak)) return { ok: false, neden: 'parmak-gecersiz' };
      const yeni = sabitler.filter((s) => s.anaBilgisayar !== anaBilgisayar);
      yeni.push({ anaBilgisayar, parmak, eklendi: new Date(simdi()).toISOString() });
      if (yeni.length > EN_COK_SABIT) return { ok: false, neden: 'cok-fazla' };
      sabitler = yeni;
      return { ok: true };
    });
  }

  function sabitSil(anaBilgisayarGirdisi) {
    return degistir(() => {
      const anaBilgisayar = anaBilgisayarCoz(anaBilgisayarGirdisi);
      const kalan = sabitler.filter((s) => s.anaBilgisayar !== anaBilgisayar);
      if (kalan.length === sabitler.length) return { ok: false, neden: 'yok' };
      sabitler = kalan;
      return { ok: true };
    });
  }

  /** Arayüze/durum bilgisine giden özet: PEM içermez. */
  function ozet() {
    return {
      ca: kokler.map((k) => ({ parmak: k.parmak, ad: k.ad, baslangic: k.baslangic, bitis: k.bitis })),
      sabit: sabitler.map((s) => ({ anaBilgisayar: s.anaBilgisayar, parmak: s.parmak, eklendi: s.eklendi })),
    };
  }

  return {
    yukle,
    hazir,
    hazirMi,
    kokPemleri: () => kokler.map((k) => k.pem),
    kokler: () => kokler.map((k) => ({ ...k })),
    sabitler: () => sabitler.map((s) => ({ ...s })),
    sabitBul: (anaBilgisayar) => sabitler.find((s) => s.anaBilgisayar === anaBilgisayar) ?? null,
    bos: () => kokler.length === 0 && sabitler.length === 0,
    kokEkle,
    kokSil,
    sabitle,
    sabitSil,
    ozet,
    degistiDinle(fn) {
      dinleyiciler.add(fn);
      return () => dinleyiciler.delete(fn);
    },
  };
}

module.exports = { sertifikaDeposuOlustur };
