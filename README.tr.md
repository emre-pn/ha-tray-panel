# ha-tray-panel

Ev Paneli, [Home Assistant](https://www.home-assistant.io/) için bir Windows tepsi uygulamasıdır. Sık kullandığın cihazlar için hızlı bir panel, klavyeyle çalışan bir komut paleti ve genel kısayollar sunar; HA panon da bir tık uzağında durur.

[English](README.md) | Türkçe

## Özellikler

- Tepsi simgesinden açılan hızlı panel: ışıklar (hazır parlaklık düğmeleri ve kaydırıcıyla), sahneler, medya ve bilgisayar eylemleri, bir de "son kullanılanlar" satırı.
- Bulanık aramalı komut paleti (`Ctrl+Alt+P`). `masa 40` yazınca ışık %40 olur, `masa 0` kapatır.
- Ana pencere, palet, her favori ve her HA panosu için genel kısayollar. Kısayol kutuları bastığın tuşları kendisi yazar.
- HA panon, odağı kaybedince gizlenen dar ya da geniş bir pencerede.
- Home Assistant WebSocket API'siyle canlı durum; bağlantı yoksa REST yoklaması.
- Ev içi ve dış adres: uygulama önce ev adresini dener, ulaşamazsa dış adrese geçer.
- Stream Deck, Görev Zamanlayıcı ve betikler için komut satırı: `"Ev Paneli.exe" --eylem="masa 40"`.
- İklimlendirme, medya oynatıcı, süpürge, vantilatör, nem alma, seçim, sayı ve zamanlayıcı kartları; ışıklar için renk ve beyaz ton ayarı.
- Perde ve jaluzi kartları (aç, durdur, kapat, konum), vana ve otomasyon kartları. Vana ve otomasyon için her zaman basılı tutmak gerekir; kısayoldan ve komut satırından hiç çalışmazlar.
- İstersen açılan kamera anlık görüntüsü (durağan bir kare, canlı yayın yok): varsayılan olarak kapalıdır, kameraları Ayarlar'da tek tek onaylarsın, görüntü bulanık başlar, yalnız bellekte durur ve bir kameraya izin verilmişken panel ekran görüntüsünden gizlenir.
- İstersen açılan bilgi kartları: grafikli sensör şeridi, saat, hava durumu ve tahmin, salt okunur takvim ve yapılacaklar listeleri. Medya kartlarında albüm kapağı görünür.
- Sağ tık menüsü, sayfalar (sekmeler), odaya göre gruplama, karo simgesi, rengi ve boyutu, geri alınabilir sıralama ve masaüstüne sabitlenen karolar.
- Geri al (`Ctrl+Alt+Z`), gecikmeli eylemler (`masa 10 dk sonra kapat`) ve hangi eylemin nereden çalıştığını gösteren yerel etkinlik geçmişi.
- Home Assistant iletileri, düşük pil ve güncellemeler için panelde bildirimler; uyarı kuralları ve sessiz saatler. Masaüstü bildirimi isteğe bağlıdır.
- İstersen açılan dış tetikler (hepsi varsayılan olarak kapalı): Jump List görevleri, masaüstü kısayolları, `evpaneli://` bağlantıları, 127.0.0.1 üzerinde yerel API, bilgisayar olayları (kilit, uyku) ve toplantı ışığı. Yalnız adıyla seçtiğin zararsız favorileri çalıştırırlar.
- İstersen Home Assistant mobil uygulaması olarak kayıt: `notify.mobile_app_*` bildirimleri düğmeleriyle bilgisayarına gelir.
- Zor kurulumlar için bağlantı seçenekleri: özel HTTP üstbilgileri (örneğin Cloudflare Access), özel kök sertifika ya da sabitlenmiş sertifika, tarayıcıyla giriş ve seçtiğin bir klasör üzerinden ayar eşitleme.
- Açık, koyu ve yüksek karşıtlıklı tema; hazır ya da özel renkler, metin boyutu, Windows 11 mika/akrilik görünüm; Türkçe, İngilizce, Almanca, Fransızca ve İspanyolca arayüz.
- Ayar araması, ayarları dışa/içe aktarma ve otomatik yedekler, sır içermeyen tanılama raporu; sürüm denetimi ve uygulama içi güncelleme varsayılan olarak kapalıdır.
- Kurulum gerektirmeyen taşınabilir sürüm.

## Güvenlik

Uygulama gerçek cihazları yönettiği için bazı kurallar yerleşik ve değiştirilemez:

- Kilitler, alarm panelleri, sirenler, kapılar, garaj kapıları, bariyerler, diafonlar, kepenkler ve benzerleri hiçbir zaman listelenmez, favoriye eklenmez, kısayola bağlanmaz ve çalıştırılmaz. Bunları içeren sahneler de engellenir.
- Kapı zili, kapı, giriş ve diafon kameraları hiçbir zaman listelenmez ya da gösterilmez. Yalnız perde, jaluzi, gölgelik ve tente kapak sayılır; garaj kapısı, bariyer ve kepenk engelli kalır.
- Bilgisayarı kapatmak, vanayı kapatmak ya da bir otomasyonu çalıştırmak gibi eylemler için yaklaşık bir saniye basılı tutmak gerekir.
- Erişim anahtarı Electron `safeStorage` (Windows DPAPI) ile şifrelenir. Günlüğe ya da dışa aktarılan dosyaya girmez; bir adrese gönderilmeden önce o adres anahtarsız doğrulanır.
- Vana, otomasyon ve kamera ile onay isteyen hiçbir eylem uygulamanın dışından (dış tetik, yerel API, bağlantı, bilgisayar olayı) başlatılamaz.
- Home Assistant anahtarı reddederse uygulama tekrar denemek yerine o anahtarı her yerde kullanmayı bırakır; böylece HA'nın IP yasağına takılmazsın.
- Düz `http://` yalnız yerel ağ adreslerinde kabul edilir.
- Sen açmadıkça Home Assistant dışında kimseye bir şey gönderilmez (yalnız sürüm denetimi ve uygulama içi güncelleme isteğe bağlıdır). Telemetri yoktur; adresin ve anahtarın üçüncü bir tarafa gitmez.

## Gereksinimler

- Windows 11 (x64). Windows 10'da çalışması beklenir ama denenmedi.
- [Uzun ömürlü erişim anahtarı](https://www.home-assistant.io/docs/authentication/#your-account-profile) olan bir Home Assistant.
- Kaynaktan derlemek için Node.js 24.

## Kurulum

[Son sürümden](https://github.com/emre-pn/ha-tray-panel/releases/latest) `Ev-Paneli-Kurulum-<sürüm>.exe` dosyasını indirip çalıştır. Yalnız senin kullanıcın için kurulur, yönetici izni istemez.

Kurulum dosyası imzalı olmadığı için Windows SmartScreen ilk seferde uyarı gösterebilir (Ek bilgi → Yine de çalıştır). Her sürüm sayfasında kurulum dosyasının SHA-256 özeti yazar; indirdiğin dosyayı onunla doğrulayabilirsin.

### Kaynaktan derleme

```bash
git clone https://github.com/emre-pn/ha-tray-panel.git
cd ha-tray-panel
npm ci
npm run dist
```

Kurulum dosyası `dist/` klasörüne düşer.

## Başlarken

1. Tepsi simgesine sağ tıklayıp Ayarlar'ı aç.
2. Ev içi adresini (ör. `http://homeassistant.local:8123`) ve varsa dış HTTPS adresini yaz.
3. Uzun ömürlü erişim anahtarını yapıştır.
4. Favorilerini seç. Tepsi menüsünde, hızlı panelde ve palette görünürler.

Arayüz dili varsayılan olarak Windows'un dilini izler. Ayarlar → Görünüm → Dil'den değiştirebilirsin.

## Geliştirme

```bash
npm start          # geliştirme kipinde çalıştırır
npm test           # testleri çalıştırır (Home Assistant gerekmez)
npm run kontrol    # statik denetim
npm run ikon       # simgeleri yeniden üretir
npm run dist       # Windows kurulum dosyasını derler
npm run dist:tasinabilir   # taşınabilir exe'yi derler (kurulumsuz)
```

Kod, yorumlar ve tanımlayıcılar Türkçedir. Testler hiçbir zaman gerçek bir Home Assistant'a bağlanmaz; bütün ağ çağrıları sahtedir. Ayrıntılı kılavuz [docs/KILAVUZ.md](docs/KILAVUZ.md), sürüm notları [CHANGELOG.md](CHANGELOG.md) dosyasında.

## Katkı

Hata bildirimleri, çeviri düzeltmeleri ve pull request'ler memnuniyetle karşılanır. Önce [CONTRIBUTING.md](CONTRIBUTING.md) dosyasına göz at. Güvenlik açıklarını [SECURITY.md](SECURITY.md) dosyasında anlatıldığı gibi gizli olarak bildir.

## Lisans

[MIT](LICENSE) © Emre Sav ([@emre-pn](https://github.com/emre-pn))

Bu proje Home Assistant ya da Nabu Casa ile bağlantılı değildir.
