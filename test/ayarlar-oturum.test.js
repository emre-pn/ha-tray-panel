'use strict';

/**
 * Ayarlar > Bağlantı > Tarayıcıyla giriş (o-57; src/ayarlar-oturum.js). Sahte DOM ve sahte köprü (test/ayarlar-sahte.js, test/baglanti-sahte.js);
 * gerçek ağ, tarayıcı ya da Electron yok. Köprü yanıtlarında jeton/kod alanı bulunmaz (sayfa onları hiç görmez).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { AYAR_D3, CIHAZLAR_D3, akit, acilmisSayfa } = require('./ayarlar-sahte');
const AYARLAR = require('../src/lib/ceviri/ayarlar');

const P = 'ayar.baglanti.oturum.';
const doldur = (metin, d = {}) => metin.replace(/\{(\w+)\}/g, (_, k) => String(d[k]));
const tr = (anahtar, d) => doldur(AYARLAR.tr[anahtar], d);
const en = (anahtar, d) => doldur(AYARLAR.en[anahtar], d);

const ac = (baglantiYaniti = {}, ek = {}) => acilmisSayfa({ ayar: AYAR_D3, cihazlar: CIHAZLAR_D3, baglantiYaniti, ...ek });
const tikla = async (sayfa, kimlik) => {
  sayfa.oge(kimlik).dispatchEvent({ type: 'click' });
  await akit();
};
const oturumCagrilari = (sayfa) => sayfa.cagrilar.filter((c) => ['tarayiciGirisiBaslat', 'tarayiciGirisiniIptalEt', 'tarayiciOturumunuKapat'].includes(c[0])).map((c) => c[0]);
const durum = (sayfa) => sayfa.oge('oturumDurum').textContent;
const ileti = (sayfa) => sayfa.oge('oturumSonuc').textContent;
const gorunur = (sayfa, kimlik) => sayfa.oge(kimlik).style.display !== 'none';
/** Ana süreç 'ayarlar:oturum-degisti' gönderdi. */
const olay = async (sayfa) => {
  for (const f of [...sayfa.baglantiDeposu.oturumDinleyicileri]) f();
  await akit();
};
const AKTIF = { var: true, cozuldu: true, anaBilgisayar: '192.168.1.50:8123', asama: 'yok', kalanSn: 0, erisim: 'taze', son: null };

test('açılış: oturum yok, giriş düğmesi açık, vazgeç ve oturumu kapat gizli; açılışta eylem çağrılmaz', async () => {
  const sayfa = await ac();
  assert.equal(durum(sayfa), tr(`${P}durum.yok`));
  assert.equal(ileti(sayfa), '');
  assert.equal(sayfa.oge('btnOturumGiris').disabled, false);
  assert.equal(gorunur(sayfa, 'btnOturumIptal'), false);
  assert.equal(gorunur(sayfa, 'btnOturumCikis'), false);
  assert.deepEqual(oturumCagrilari(sayfa), []);
});

test('giriş: onay istenir; onaylanırsa tarayıcı girişi başlar, bekleme durumu ve Vazgeç görünür, giriş düğmesi kapanır', async () => {
  const sayfa = await ac();
  await tikla(sayfa, 'btnOturumGiris');
  assert.deepEqual(sayfa.sorular, [tr(`${P}girisOnay`)]);
  assert.deepEqual(oturumCagrilari(sayfa), ['tarayiciGirisiBaslat']);
  assert.equal(durum(sayfa), tr(`${P}durum.bekliyor`, { dk: 5 }));
  assert.equal(sayfa.oge('btnOturumGiris').disabled, true);
  assert.equal(gorunur(sayfa, 'btnOturumIptal'), true);
  assert.equal(gorunur(sayfa, 'btnOturumCikis'), false);
  assert.equal(sayfa.etkinZamanlayicilar().some((z) => z.ms === 2500), true, 'olay gelmezse bekleme sürerken durum yeniden sorulur');
});

test('giriş: elle yapıştırılmış anahtar varken onay metni onu sileceğini söyler; onaylanmazsa hiçbir çağrı gitmez', async () => {
  const sayfa = await ac({}, { ayar: { ...AYAR_D3, girisTuru: 'anahtar' } });
  await tikla(sayfa, 'btnOturumGiris');
  assert.deepEqual(sayfa.sorular, [tr(`${P}girisOnayAnahtar`)]);
  const hayir = await ac({}, { onayYaniti: false });
  await tikla(hayir, 'btnOturumGiris');
  assert.deepEqual(oturumCagrilari(hayir), []);
  assert.equal(durum(hayir), tr(`${P}durum.yok`));
});

test('giriş başlatılamazsa neden koduna göre ileti gösterilir; bilinmeyen neden genel iletiye düşer', async () => {
  const durumlar = {
    suruyor: 'hata.suruyor',
    'sifreleme-yok': 'hata.sifrelemeYok',
    'adres-yok': 'hata.adresYok',
    dinleyici: 'hata.dinleyici',
    tarayici: 'hata.tarayici',
    beklenmedik: 'hata.genel',
  };
  for (const [neden, anahtar] of Object.entries(durumlar)) {
    const sayfa = await ac({ tarayiciGirisiBaslat: () => ({ ok: false, neden }) });
    await tikla(sayfa, 'btnOturumGiris');
    assert.equal(ileti(sayfa), tr(`${P}${anahtar}`), neden);
    assert.equal(sayfa.oge('oturumSonuc').className, 'ipucu alan-sonuc-sorun');
    assert.equal(sayfa.oge('btnOturumGiris').disabled, false, 'yeniden denenebilir');
  }
  const patlayan = await ac({ tarayiciGirisiBaslat: () => { throw new Error('ipc koptu'); } });
  await tikla(patlayan, 'btnOturumGiris');
  assert.equal(ileti(patlayan), tr(`${P}hata.genel`));
});

test('vazgeç: bekleyen giriş iptal edilir, ileti gösterilir, düğmeler eski haline döner', async () => {
  const sayfa = await ac();
  await tikla(sayfa, 'btnOturumGiris');
  await tikla(sayfa, 'btnOturumIptal');
  assert.deepEqual(oturumCagrilari(sayfa), ['tarayiciGirisiBaslat', 'tarayiciGirisiniIptalEt']);
  assert.equal(ileti(sayfa), tr(`${P}sonuc.iptal`));
  assert.equal(durum(sayfa), tr(`${P}durum.yok`));
  assert.equal(gorunur(sayfa, 'btnOturumIptal'), false);
  assert.equal(sayfa.oge('btnOturumGiris').disabled, false);
});

test('giriş tamamlanınca (ana süreç olayı) oturum görünür, başarı iletisi yazılır ve anahtar bölümü yeniden okunur', async () => {
  const sayfa = await ac();
  await tikla(sayfa, 'btnOturumGiris');
  const once = sayfa.getirSayisi();
  sayfa.baglantiDeposu.oturum = { ...AKTIF, son: { sonuc: 'tamam', neden: null } };
  await olay(sayfa);
  assert.equal(durum(sayfa), tr(`${P}durum.var`, { ana: '192.168.1.50:8123' }));
  assert.equal(ileti(sayfa), tr(`${P}sonuc.tamam`));
  assert.equal(sayfa.oge('oturumSonuc').className, 'ipucu alan-sonuc-tamam');
  assert.equal(gorunur(sayfa, 'btnOturumCikis'), true);
  assert.equal(gorunur(sayfa, 'btnOturumIptal'), false);
  assert.ok(sayfa.getirSayisi() > once, 'anahtar bölümü (rozet) ve cihaz listesi tazelendi');
  assert.equal(sayfa.etkinZamanlayicilar().some((z) => z.ms === 2500), false, 'giriş bitti: yoklama durdu');
});

test('giriş sonucu hata/zaman aşımı/iptal ise ileti nedene göre yazılır', async () => {
  const sonuclar = [
    [{ sonuc: 'hata', neden: 'kod-reddedildi' }, 'hata.kodReddedildi'],
    [{ sonuc: 'hata', neden: 'yanit-gecersiz' }, 'hata.yanitGecersiz'],
    [{ sonuc: 'hata', neden: 'saklanamadi' }, 'hata.saklanamadi'],
    [{ sonuc: 'hata', neden: 'cok-fazla-deneme' }, 'hata.cokFazlaDeneme'],
    [{ sonuc: 'hata', neden: 'baglanti' }, 'hata.baglanti'],
    [{ sonuc: 'hata', neden: 'yasak' }, 'hata.yasak'],
    [{ sonuc: 'hata', neden: 'sunucu' }, 'hata.sunucu'],
    [{ sonuc: 'hata', neden: 'adres' }, 'hata.adres'],
    [{ sonuc: 'hata', neden: 'engelli' }, 'hata.engelli'],
    [{ sonuc: 'hata', neden: 'bilinmeyen' }, 'hata.genel'],
    [{ sonuc: 'zaman-asimi', neden: null }, 'sonuc.zamanAsimi'],
    [{ sonuc: 'iptal', neden: null }, 'sonuc.iptal'],
  ];
  for (const [son, anahtar] of sonuclar) {
    const sayfa = await ac();
    await tikla(sayfa, 'btnOturumGiris');
    sayfa.baglantiDeposu.oturum = { var: false, cozuldu: true, anaBilgisayar: null, asama: 'yok', kalanSn: 0, erisim: 'yok', son };
    await olay(sayfa);
    assert.equal(ileti(sayfa), tr(`${P}${anahtar}`), JSON.stringify(son));
    assert.equal(durum(sayfa), tr(`${P}durum.yok`));
  }
});

test('sayfa açılırken eski bir giriş sonucu gösterilmez (yalnız bu sayfadan izlenen giriş sonucu yazılır)', async () => {
  const sayfa = await ac({ oturum: { son: { sonuc: 'hata', neden: 'baglanti' } } });
  assert.equal(ileti(sayfa), '');
  assert.equal(durum(sayfa), tr(`${P}durum.yok`));
});

test('çıkış: onay sorulur; HA\'daki oturum iptal edilirse bunu söyler, edilemezse yerel silindiğini ve elle silme yolunu söyler', async () => {
  const sayfa = await ac({ oturum: AKTIF });
  assert.equal(durum(sayfa), tr(`${P}durum.var`, { ana: '192.168.1.50:8123' }));
  assert.equal(gorunur(sayfa, 'btnOturumCikis'), true);
  const once = sayfa.getirSayisi();
  await tikla(sayfa, 'btnOturumCikis');
  assert.deepEqual(sayfa.sorular, [tr(`${P}cikisOnay`)]);
  assert.deepEqual(oturumCagrilari(sayfa), ['tarayiciOturumunuKapat']);
  assert.equal(ileti(sayfa), tr(`${P}sonuc.cikti`));
  assert.equal(durum(sayfa), tr(`${P}durum.yok`));
  assert.equal(gorunur(sayfa, 'btnOturumCikis'), false);
  assert.ok(sayfa.getirSayisi() > once, 'anahtar bölümü tazelendi');

  const yerel = await ac({ oturum: AKTIF, tarayiciOturumunuKapat: (d) => { d.oturum = { ...d.oturum, var: false }; return { ok: true, iptalEdildi: false }; } });
  await tikla(yerel, 'btnOturumCikis');
  assert.equal(ileti(yerel), tr(`${P}sonuc.ciktiYerel`));
  assert.equal(yerel.oge('oturumSonuc').className, 'ipucu', 'HA\'da iptal edilememesi hata değil, bilgidir');

  const hayir = await ac({ oturum: AKTIF }, { onayYaniti: false });
  await tikla(hayir, 'btnOturumCikis');
  assert.deepEqual(oturumCagrilari(hayir), []);
  assert.equal(durum(hayir), tr(`${P}durum.var`, { ana: '192.168.1.50:8123' }));
});

test('oturum arka planda sona ererse (HA yenileme anahtarını reddetti) durum güncellenir ve anahtar bölümü tazelenir', async () => {
  const sayfa = await ac({ oturum: AKTIF });
  const once = sayfa.getirSayisi();
  sayfa.baglantiDeposu.oturum = { ...AKTIF, var: false, anaBilgisayar: null, erisim: 'yok' };
  await olay(sayfa);
  assert.equal(durum(sayfa), tr(`${P}durum.yok`));
  assert.equal(gorunur(sayfa, 'btnOturumCikis'), false);
  assert.ok(sayfa.getirSayisi() > once, 'rozet "eklenmedi"ye döner');
});

test('durum uyarıları: kayıt bu bilgisayarda çözülemiyor / erişim anahtarı yenilenemiyor', async () => {
  const cozulemiyor = await ac({ oturum: { ...AKTIF, cozuldu: false, anaBilgisayar: null } });
  assert.equal(durum(cozulemiyor), tr(`${P}durum.cozulemedi`));
  assert.equal(gorunur(cozulemiyor, 'btnOturumCikis'), true, 'bozuk oturum yine de kapatılabilir');
  const yenilenemiyor = await ac({ oturum: { ...AKTIF, erisim: 'yenilenemedi' } });
  assert.equal(durum(yenilenemiyor), tr(`${P}durum.yenilenemedi`));
  const tamamlaniyor = await ac({ oturum: { ...AKTIF, var: false, asama: 'tamamlaniyor' } });
  assert.equal(durum(tamamlaniyor), tr(`${P}durum.tamamlaniyor`));
  assert.equal(tamamlaniyor.oge('btnOturumGiris').disabled, true);
  assert.equal(gorunur(tamamlaniyor, 'btnOturumIptal'), false, 'kod değişimi sürerken iptal sunulmaz');
});

test('bekleme süresi dakikaya yuvarlanır (en az 1)', async () => {
  const sayfa = await ac({ oturum: { ...AKTIF, var: false, asama: 'bekliyor', kalanSn: 61 } });
  assert.equal(durum(sayfa), tr(`${P}durum.bekliyor`, { dk: 2 }));
  const az = await ac({ oturum: { ...AKTIF, var: false, asama: 'bekliyor', kalanSn: 3 } });
  assert.equal(durum(az), tr(`${P}durum.bekliyor`, { dk: 1 }));
});

test('dil değişince durum ve ileti yeni dilde yeniden yazılır', async () => {
  const sayfa = await ac({ oturum: AKTIF });
  await tikla(sayfa, 'btnOturumCikis');
  assert.equal(ileti(sayfa), tr(`${P}sonuc.cikti`));
  await sayfa.dilDegisti('en');
  assert.equal(durum(sayfa), en(`${P}durum.yok`));
  assert.equal(ileti(sayfa), en(`${P}sonuc.cikti`));
  assert.equal(sayfa.oge('btnOturumGiris').textContent, en(`${P}giris`));
  assert.equal(sayfa.oge('oturumBaslik').textContent, en(`${P}baslik`));
});

test('sayfa yalnız oturum kanallarını çağırır; yanıtlardaki bilinmeyen alanlar (jeton benzeri) ekrana yazılmaz', async () => {
  const sayfa = await ac({ oturum: { ...AKTIF, access_token: 'GIZLI-ERISIM-JETONU', refresh_token: 'GIZLI-YENILEME-JETONU', kod: 'GIZLI-KOD' } });
  const metinler = sayfa.tumOgeler().map((o) => `${o.textContent}|${o.value ?? ''}`).join('\n');
  for (const sir of ['GIZLI-ERISIM-JETONU', 'GIZLI-YENILEME-JETONU', 'GIZLI-KOD']) assert.equal(metinler.includes(sir), false);
});

test('odak: giriş başlayınca odak "Vazgeç"e geçer, vazgeçince "Tarayıcıyla giriş yap"a döner; oturumu kapatınca da giriş düğmesine geçer', async () => {
  const sayfa = await ac();
  sayfa.oge('btnOturumGiris').focus();
  await tikla(sayfa, 'btnOturumGiris');
  assert.equal(sayfa.oge('btnOturumGiris').disabled, true);
  assert.equal(sayfa.sonOdak(), sayfa.oge('btnOturumIptal'), 'pasifleşen giriş düğmesinin odağı Vazgeç düğmesine taşınır');
  await tikla(sayfa, 'btnOturumIptal');
  assert.equal(gorunur(sayfa, 'btnOturumIptal'), false);
  assert.equal(sayfa.sonOdak(), sayfa.oge('btnOturumGiris'), 'Vazgeç gizlenince odak giriş düğmesine döner');

  const cikis = await ac({ oturum: AKTIF });
  cikis.oge('btnOturumCikis').focus();
  await tikla(cikis, 'btnOturumCikis');
  assert.equal(gorunur(cikis, 'btnOturumCikis'), false);
  assert.equal(cikis.sonOdak(), cikis.oge('btnOturumGiris'));

  // onay reddedilirse ya da odak başka yerdeyse odağa dokunulmaz
  const hayir = await ac({ oturum: AKTIF }, { onayYaniti: false });
  hayir.oge('btnOturumCikis').focus();
  await tikla(hayir, 'btnOturumCikis');
  assert.equal(hayir.sonOdak(), hayir.oge('btnOturumCikis'));
  const baska = await ac();
  baska.oge('btnUstbilgiEkle').focus();
  await tikla(baska, 'btnOturumGiris');
  assert.equal(baska.sonOdak(), baska.oge('btnUstbilgiEkle'), 'kullanıcı odağı başka yerde tutuyorsa çekilmez');
});

test('yoklama zinciri: giriş beklenirken tek bir durum isteği başarısız olursa yoklama sürer ve sonraki başarılı yanıt arayüzü günceller', async () => {
  let cagri = 0;
  const sayfa = await ac({
    oturum: { ...AKTIF, var: false, asama: 'bekliyor', kalanSn: 200 },
    oturumDurumuGetir: (d) => {
      cagri += 1;
      if (cagri === 2) return { ok: false }; // ilk yoklama düşer (olay da gelmedi)
      return { ok: true, oturum: JSON.parse(JSON.stringify(d.oturum)) };
    },
  });
  const yoklama = (s) => s.etkinZamanlayicilar().filter((z) => z.ms === 2500).at(-1);
  const tetikle = async (z) => {
    z.iptal = true;
    z.islev();
    await akit();
  };
  assert.ok(yoklama(sayfa));
  await tetikle(yoklama(sayfa));
  assert.equal(cagri, 2);
  assert.ok(yoklama(sayfa), 'istek başarısız oldu ama zincir kopmadı: yeni yoklama kuruldu');
  assert.equal(durum(sayfa), tr(`${P}durum.bekliyor`, { dk: 4 }), 'başarısız yoklamada son bilinen durum korunur');
  sayfa.baglantiDeposu.oturum = { ...AKTIF, son: { sonuc: 'tamam', neden: null } };
  await tetikle(yoklama(sayfa));
  assert.equal(durum(sayfa), tr(`${P}durum.var`, { ana: '192.168.1.50:8123' }));
  assert.equal(gorunur(sayfa, 'btnOturumIptal'), false);
  assert.equal(gorunur(sayfa, 'btnOturumCikis'), true);
  assert.equal(yoklama(sayfa), undefined, 'giriş bitti: yoklama durur');
});

test('vazgeç reddedilirse (kod değişimi başladı) "Vazgeçildi" yazılmaz; giriş tamamlanınca başarı iletisi gösterilir', async () => {
  const sayfa = await ac({ tarayiciGirisiniIptalEt: () => ({ ok: false, neden: 'tamamlaniyor' }) });
  await tikla(sayfa, 'btnOturumGiris');
  await tikla(sayfa, 'btnOturumIptal');
  assert.deepEqual(oturumCagrilari(sayfa), ['tarayiciGirisiBaslat', 'tarayiciGirisiniIptalEt']);
  assert.notEqual(ileti(sayfa), tr(`${P}sonuc.iptal`), 'iptal edilmeyen giriş "Vazgeçildi" diye bildirilmez');
  assert.equal(ileti(sayfa), tr(`${P}durum.tamamlaniyor`));
  assert.equal(sayfa.oge('oturumSonuc').className, 'ipucu');
  sayfa.baglantiDeposu.oturum = { ...AKTIF, son: { sonuc: 'tamam', neden: null } };
  await olay(sayfa);
  assert.equal(ileti(sayfa), tr(`${P}sonuc.tamam`), 'girisGoruldu korunduğu için sonuç yine iletiye çevrilir');
  assert.equal(durum(sayfa), tr(`${P}durum.var`, { ana: '192.168.1.50:8123' }));

  // bilinmeyen ret nedeni genel hata olur
  const garip = await ac({ tarayiciGirisiniIptalEt: () => ({ ok: false, neden: 'x' }) });
  await tikla(garip, 'btnOturumGiris');
  await tikla(garip, 'btnOturumIptal');
  assert.equal(ileti(garip), tr(`${P}hata.genel`));
});
