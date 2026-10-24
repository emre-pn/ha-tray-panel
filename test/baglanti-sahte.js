'use strict';

/**
 * Ayarlar sayfası testleri için bağlantı katmanı (o-55..o-58) SAHTE köprüsü: ana süreç işleyicilerinin bellek içi karşılığı.
 * Gerçek ağ, Electron ya da şifreleme yok. `ayarlar-sahte.js` bunu `evPaneli` nesnesine yayar.
 * Açılışta çağrılan okumalar (baglantiDurumuGetir) `cagrilar`a yazılmaz; kullanıcı eylemleri yazılır.
 */

const duzles = (nesne) => JSON.parse(JSON.stringify(nesne));
const SAHTE_PARMAK = 'ab'.repeat(32);
const bicimle = (hex) => hex.toUpperCase().replace(/(..)(?!$)/g, '$1:');

/**
 * @param {object} bag
 * @param {Array} bag.cagrilar sayfa testinin çağrı günlüğü
 * @param {object} [bag.secenek] testin geçersiz kılmaları: { ustbilgiAdlari, durum(fn), ustbilgileriKaydet(fn), ustbilgileriSil(fn), ustbilgileriDene(fn),
 *   sertifikaAdresleri, sertifikaCa, sertifikaSabit, sertifikaOku(fn), parmakIziniSabitle(fn), parmakSabitlemeyiKaldir(fn), kokSertifikaEkle(fn), kokSertifikayiKaldir(fn),
 *   oturum (başlangıç durumu), tarayiciGirisiBaslat(fn), tarayiciGirisiniIptalEt(fn), tarayiciOturumunuKapat(fn),
 *   esitleme (başlangıç durumu), esitlemeSecilecek (diyalogda seçilecek yol; null: vazgeç), esitlemeDosyaVar, esitlemeDurumuGetir(fn), esitlemeKlasoruSec(fn),
 *   esitlemeyiAyarla(fn), simdiEsitle(fn), esitlemeParolasiniKaydet(fn), esitlemeParolasiniSil(fn) }
 */
function baglantiKopruSahtesi({ cagrilar, secenek = {} }) {
  const durum = {
    ustbilgiAdlari: [...(secenek.ustbilgiAdlari ?? [])],
    ustbilgiDegerleri: new Map(),
    // sertifika güveni (o-56)
    sertifikaAdresleri: duzles(secenek.sertifikaAdresleri ?? [{ tur: 'yerel', anaBilgisayar: '192.168.1.50', kapi: 8123 }, { tur: 'dis', anaBilgisayar: 'ha.example.com', kapi: 443 }]),
    sertifikaCa: duzles(secenek.sertifikaCa ?? []), // { parmak, ad, bitis }
    sertifikaSabit: duzles(secenek.sertifikaSabit ?? []), // { anaBilgisayar, parmak }
    // tarayıcıyla giriş (o-57): ana sürecin oturum:durum yanıtının bellek içi karşılığı (jeton/kod yok)
    oturum: { var: false, cozuldu: true, anaBilgisayar: null, asama: 'yok', kalanSn: 0, erisim: 'yok', son: null, ...duzles(secenek.oturum ?? {}) },
    oturumDinleyicileri: [],
    // klasörle eşitleme (o-58): ana sürecin esitleme:durum yanıtındaki `esitleme` nesnesinin bellek içi karşılığı (parola yok; yalnız parolaVar)
    esitleme: {
      acik: false,
      klasor: null,
      klasorVar: false,
      dosyaVar: false,
      tumBolumler: ['favoriler', 'kisayollar', 'gorunum', 'bilgi', 'bildirim'],
      bolumler: ['favoriler', 'kisayollar', 'gorunum', 'bilgi', 'bildirim'],
      parolaVar: false,
      sifrelemeVar: true,
      asama: 'kapali',
      neden: null,
      son: null,
      ...duzles(secenek.esitleme ?? {}),
    },
    esitlemeParolasi: null, // sahte ana süreçte saklanan parola: hiçbir yanıtta dönmez
    esitlemeDinleyicileri: [],
  };

  const esitlemeNesnesi = () => duzles(durum.esitleme);

  const sertifikaNesnesi = () => ({
    ca: durum.sertifikaCa.map((k) => ({ ...k, baslangic: '2024-01-01T00:00:00.000Z', parmakBicimli: bicimle(k.parmak) })),
    sabit: durum.sertifikaSabit.map((s) => ({ ...s, eklendi: '2026-01-01T00:00:00.000Z', parmakBicimli: bicimle(s.parmak) })),
    adresler: durum.sertifikaAdresleri.map((a) => ({ ...a, sabit: durum.sertifikaSabit.some((s) => s.anaBilgisayar === a.anaBilgisayar) })),
    enCokCa: 4,
    enCokSabit: 4,
  });

  const durumNesnesi = () => ({ ok: true, ustbilgi: { adlar: [...durum.ustbilgiAdlari], enCok: 8 }, sertifika: sertifikaNesnesi() });

  return {
    baglantiDeposu: durum,
    kopru: {
      baglantiDurumuGetir: async () => {
        if (typeof secenek.durum === 'function') return secenek.durum(durum);
        return durumNesnesi();
      },
      ustbilgileriKaydet: async (liste) => {
        cagrilar.push(['ustbilgileriKaydet', duzles(liste)]);
        if (typeof secenek.ustbilgileriKaydet === 'function') return secenek.ustbilgileriKaydet(duzles(liste), durum);
        // Ana süreç gibi: null değer kayıtlı değeri korur; kayıtlı olmayan ad için null / boş değer reddedilir.
        const hatalar = [];
        liste.forEach((o, sira) => {
          if (typeof o.ad !== 'string' || o.ad.trim() === '') hatalar.push({ sira, neden: 'ad-gecersiz' });
          else if (/^authorization$/i.test(o.ad.trim())) hatalar.push({ sira, neden: 'ad-yasak' });
          else if (o.deger === null ? !durum.ustbilgiAdlari.includes(o.ad.trim()) : String(o.deger).trim() === '') hatalar.push({ sira, neden: 'deger-yok' });
        });
        if (hatalar.length > 0) return { ok: false, hatalar };
        for (const o of liste) if (o.deger !== null) durum.ustbilgiDegerleri.set(o.ad.trim(), o.deger);
        durum.ustbilgiAdlari = liste.map((o) => o.ad.trim());
        return { ok: true, adlar: [...durum.ustbilgiAdlari] };
      },
      ustbilgileriSil: async () => {
        cagrilar.push(['ustbilgileriSil']);
        if (typeof secenek.ustbilgileriSil === 'function') return secenek.ustbilgileriSil(durum);
        durum.ustbilgiAdlari = [];
        durum.ustbilgiDegerleri.clear();
        return { ok: true, adlar: [] };
      },
      ustbilgileriDene: async () => {
        cagrilar.push(['ustbilgileriDene']);
        if (typeof secenek.ustbilgileriDene === 'function') return secenek.ustbilgileriDene(durum);
        return { ok: true, sonuclar: [{ tur: 'yerel', ok: true, ulasilabilir: true, neden: 'tamam', mesaj: 'Home Assistant bulundu: adres çalışıyor.' }], ustbilgiSayisi: durum.ustbilgiAdlari.length };
      },

      // ---- Sertifika güveni (o-56) ----
      sertifikaOku: async (tur) => {
        cagrilar.push(['sertifikaOku', tur]);
        if (typeof secenek.sertifikaOku === 'function') return secenek.sertifikaOku(tur, durum);
        const adres = durum.sertifikaAdresleri.find((a) => a.tur === tur);
        if (!adres) return { ok: false, neden: 'adres-yok' };
        return {
          ok: true,
          tur,
          anaBilgisayar: adres.anaBilgisayar,
          kapi: adres.kapi,
          parmak: SAHTE_PARMAK,
          parmakBicimli: bicimle(SAHTE_PARMAK),
          ad: 'ha.test',
          veren: 'Test Kok CA',
          sanlar: ['ha.test', '192.168.1.50'],
          baslangic: '2026-01-01T12:00:00.000Z', // öğlen: yerel saat dilimine bağlı gün kaymasın
          bitis: '2030-01-01T12:00:00.000Z',
          kendindenImzali: false,
          sistemGuveniyor: false,
        };
      },
      parmakIziniSabitle: async (tur, parmak) => {
        cagrilar.push(['parmakIziniSabitle', tur, parmak]);
        if (typeof secenek.parmakIziniSabitle === 'function') return secenek.parmakIziniSabitle(tur, parmak, durum);
        const hex = String(parmak).replace(/[\s:-]/g, '').toLowerCase();
        if (!/^[0-9a-f]{64}$/.test(hex)) return { ok: false, neden: 'parmak-gecersiz' };
        const adres = durum.sertifikaAdresleri.find((a) => a.tur === tur);
        if (!adres) return { ok: false, neden: 'https-degil' };
        durum.sertifikaSabit = durum.sertifikaSabit.filter((s) => s.anaBilgisayar !== adres.anaBilgisayar).concat([{ anaBilgisayar: adres.anaBilgisayar, parmak: hex }]);
        return { ok: true };
      },
      parmakSabitlemeyiKaldir: async (anaBilgisayar) => {
        cagrilar.push(['parmakSabitlemeyiKaldir', anaBilgisayar]);
        if (typeof secenek.parmakSabitlemeyiKaldir === 'function') return secenek.parmakSabitlemeyiKaldir(anaBilgisayar, durum);
        const once = durum.sertifikaSabit.length;
        durum.sertifikaSabit = durum.sertifikaSabit.filter((s) => s.anaBilgisayar !== anaBilgisayar);
        return durum.sertifikaSabit.length < once ? { ok: true } : { ok: false, neden: 'yok' };
      },
      kokSertifikaEkle: async () => {
        cagrilar.push(['kokSertifikaEkle']);
        if (typeof secenek.kokSertifikaEkle === 'function') return secenek.kokSertifikaEkle(durum);
        if (durum.sertifikaCa.length >= 4) return { ok: false, neden: 'cok-fazla' };
        durum.sertifikaCa.push({ parmak: 'cd'.repeat(32), ad: 'Ev Kok CA', bitis: '2035-06-30T12:00:00.000Z' });
        return { ok: true, eklenen: 1, atlanan: 0 };
      },
      // ---- Tarayıcıyla giriş (o-57) ----
      oturumDurumuGetir: async () => {
        if (typeof secenek.oturumDurumuGetir === 'function') return secenek.oturumDurumuGetir(durum);
        return { ok: true, oturum: duzles(durum.oturum) };
      },
      tarayiciGirisiBaslat: async () => {
        cagrilar.push(['tarayiciGirisiBaslat']);
        if (typeof secenek.tarayiciGirisiBaslat === 'function') return secenek.tarayiciGirisiBaslat(durum);
        durum.oturum = { ...durum.oturum, asama: 'bekliyor', kalanSn: 300, son: null };
        return { ok: true };
      },
      tarayiciGirisiniIptalEt: async () => {
        cagrilar.push(['tarayiciGirisiniIptalEt']);
        if (typeof secenek.tarayiciGirisiniIptalEt === 'function') return secenek.tarayiciGirisiniIptalEt(durum);
        durum.oturum = { ...durum.oturum, asama: 'yok', kalanSn: 0, son: { sonuc: 'iptal', neden: null } };
        return { ok: true };
      },
      tarayiciOturumunuKapat: async () => {
        cagrilar.push(['tarayiciOturumunuKapat']);
        if (typeof secenek.tarayiciOturumunuKapat === 'function') return secenek.tarayiciOturumunuKapat(durum);
        durum.oturum = { ...durum.oturum, var: false, anaBilgisayar: null, erisim: 'yok' };
        return { ok: true, iptalEdildi: true };
      },
      onOturumDegisti: (geriCagri) => {
        durum.oturumDinleyicileri.push(geriCagri);
        return () => {
          durum.oturumDinleyicileri = durum.oturumDinleyicileri.filter((f) => f !== geriCagri);
        };
      },
      // ---- Klasörle eşitleme (o-58) ----
      esitlemeDurumuGetir: async () => {
        if (typeof secenek.esitlemeDurumuGetir === 'function') return secenek.esitlemeDurumuGetir(durum);
        return { ok: true, esitleme: esitlemeNesnesi() };
      },
      esitlemeKlasoruSec: async () => {
        cagrilar.push(['esitlemeKlasoruSec']);
        if (typeof secenek.esitlemeKlasoruSec === 'function') return secenek.esitlemeKlasoruSec(durum);
        const yol = secenek.esitlemeSecilecek === undefined ? 'C:\\Eşitleme' : secenek.esitlemeSecilecek; // null: kullanıcı vazgeçti
        if (yol === null) return { ok: false, iptal: true };
        durum.esitleme = { ...durum.esitleme, acik: false, klasor: yol, klasorVar: true, dosyaVar: secenek.esitlemeDosyaVar === true, asama: 'kapali', neden: null, son: null };
        return { ok: true, esitleme: esitlemeNesnesi() };
      },
      esitlemeyiAyarla: async (girdi) => {
        cagrilar.push(['esitlemeyiAyarla', duzles(girdi)]);
        if (typeof secenek.esitlemeyiAyarla === 'function') return secenek.esitlemeyiAyarla(duzles(girdi), durum);
        const e = durum.esitleme;
        if (Array.isArray(girdi.bolumler)) e.bolumler = girdi.bolumler.filter((b) => e.tumBolumler.includes(b));
        if (girdi.acik === true) {
          if (!e.klasor) return { ok: false, neden: 'klasor-yok' };
          if (e.bolumler.length === 0) return { ok: false, neden: 'bolum-yok' };
          e.acik = true;
          e.asama = 'bekliyor';
        } else if (girdi.acik === false) {
          e.acik = false;
          e.asama = 'kapali';
          e.neden = null;
        }
        return { ok: true, esitleme: esitlemeNesnesi() };
      },
      simdiEsitle: async () => {
        cagrilar.push(['simdiEsitle']);
        if (typeof secenek.simdiEsitle === 'function') return secenek.simdiEsitle(durum);
        const e = durum.esitleme;
        if (!e.acik) return { ok: false, neden: 'kapali' };
        e.asama = 'tamam';
        e.neden = null;
        e.son = { zaman: 1_800_000_000_000, uygulanan: 0, yazilan: 1 };
        return { ok: true, neden: null, esitleme: esitlemeNesnesi() };
      },
      esitlemeParolasiniKaydet: async (parola) => {
        cagrilar.push(['esitlemeParolasiniKaydet', parola]);
        if (typeof secenek.esitlemeParolasiniKaydet === 'function') return secenek.esitlemeParolasiniKaydet(parola, durum);
        if (typeof parola !== 'string' || parola.length < 8 || parola.length > 128) return { ok: false, neden: 'parola-gecersiz' };
        if (!durum.esitleme.sifrelemeVar) return { ok: false, neden: 'sifreleme-yok' };
        durum.esitlemeParolasi = parola;
        durum.esitleme.parolaVar = true;
        return { ok: true, esitleme: esitlemeNesnesi() };
      },
      esitlemeParolasiniSil: async () => {
        cagrilar.push(['esitlemeParolasiniSil']);
        if (typeof secenek.esitlemeParolasiniSil === 'function') return secenek.esitlemeParolasiniSil(durum);
        durum.esitlemeParolasi = null;
        durum.esitleme.parolaVar = false;
        return { ok: true, esitleme: esitlemeNesnesi() };
      },
      onEsitlemeDegisti: (geriCagri) => {
        durum.esitlemeDinleyicileri.push(geriCagri);
        return () => {
          durum.esitlemeDinleyicileri = durum.esitlemeDinleyicileri.filter((f) => f !== geriCagri);
        };
      },
      kokSertifikayiKaldir: async (parmak) => {
        cagrilar.push(['kokSertifikayiKaldir', parmak]);
        if (typeof secenek.kokSertifikayiKaldir === 'function') return secenek.kokSertifikayiKaldir(parmak, durum);
        const once = durum.sertifikaCa.length;
        durum.sertifikaCa = durum.sertifikaCa.filter((k) => k.parmak !== parmak);
        return durum.sertifikaCa.length < once ? { ok: true } : { ok: false, neden: 'yok' };
      },
    },
  };
}

module.exports = { baglantiKopruSahtesi, SAHTE_PARMAK };
