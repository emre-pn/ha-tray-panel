# ha-tray-panel

Ev Paneli, [Home Assistant](https://www.home-assistant.io/) için bir Windows tepsi uygulamasıdır. Sık kullandığın cihazlar için hızlı bir panel, klavyeyle çalışan bir komut paleti ve genel kısayollar sunar; HA panon da bir tık uzağında durur.

[English](README.md) | Türkçe

<p align="center">
<img src="docs/screenshots/quick-panel.png" width="280" alt="Hızlı panel">
&nbsp;
<img src="docs/screenshots/palette-search.png" width="480" alt="Komut paleti">
</p>

## Özellikler

- Tepsi simgesinden açılan hızlı panel: en üstte saat, yanında hava durumu ve altında çalan parça şeridi; ışıklar, sahneler, medya ve bilgisayar eylemleri, bir de "son kullanılanlar" satırı. Işık, parlaklığı kadar dolan kompakt bir satırdır: üstünde yana sürükle, Shift + ← / → ya da tekerlekle kıs; hazır seviyeler, kaydırıcı ve renkler "⋯" ile açılır. Her karonun simgesi yuvarlak bir rozette durur, Home Assistant'ın yanıtı ✓ ya da ! rozetiyle görünür.
- Her eylemden sonra köşede küçük bir bildirim: cihazın simgesi, adı ve ne olduğu (örneğin "Kapatıldı" ya da "Parlaklık %80").
- Bulanık aramalı komut paleti (`Ctrl+Alt+P`). `masa 40` yazınca ışık %40 olur, `masa 0` kapatır.
- Ana pencere, palet, her favori ve her HA panosu için genel kısayollar. Kısayol kutuları bastığın tuşları kendisi yazar.
- HA panon, odağı kaybedince gizlenen dar ya da geniş bir pencerede.
- Home Assistant WebSocket API'siyle canlı durum; bağlantı yoksa REST yoklaması.
- Ev içi ve dış adres: uygulama önce ev adresini dener, ulaşamazsa dış adrese geçer.
- Stream Deck, Görev Zamanlayıcı ve betikler için komut satırı: `"Ev Paneli.exe" --eylem="masa 40"`.
- İklimlendirme, medya oynatıcı, süpürge, vantilatör, nem alma, seçim, sayı ve zamanlayıcı kartları; ışıklar için renk ve beyaz ton ayarı. İklim kartında ısıtma/soğutma aralığı, fan modu ve hazır ayar; medya kartında 10 sn ileri/geri sarma; sensör karolarında gösterge aralığı ve grafik biçimi vardır.
- Perde ve jaluzi kartları (aç, durdur, kapat, konum), vana ve otomasyon kartları. Vana ve otomasyon için her zaman basılı tutmak gerekir; kısayoldan ve komut satırından hiç çalışmazlar.
- İstersen açılan kamera anlık görüntüsü (durağan bir kare, canlı yayın yok): varsayılan olarak kapalıdır, kameraları Ayarlar'da tek tek onaylarsın, görüntü bulanık başlar, yalnız bellekte durur ve bir kameraya izin verilmişken panel ekran görüntüsünden gizlenir. Kamera kartı büyütülebilir ve istenince yenilenebilir.
- İstersen açılan bilgi kartları: grafikli sensör şeridi, saat, hava durumu ve tahmin, salt okunur takvim ve yapılacaklar listeleri. Medya kartlarında albüm kapağı görünür.
- Sağ tık menüsü, sayfalar (sekmeler), odaya göre gruplama, karo simgesi, rengi ve boyutu, geri alınabilir sıralama ve masaüstüne sabitlenen karolar. Karo menüsünden bir favori masaüstüne sabitlenir, karo simgeleri aranabilir emoji seçiciden gelir, palet paneli seçtiğin sayfada açabilir.
- İstersen tepsi simgesinde rozet: açık ışık sayısı ya da 5 saniyede bir sırayla gösterilen en çok üç sensör.
- Geri al (`Ctrl+Alt+Z`), gecikmeli eylemler (`masa 10 dk sonra kapat`) ve hangi eylemin nereden çalıştığını gösteren yerel etkinlik geçmişi.
- Home Assistant iletileri, düşük pil ve güncellemeler için panelde bildirimler; uyarı kuralları ve sessiz saatler. Masaüstü bildirimi isteğe bağlıdır.
- İstersen açılan dış tetikler (hepsi varsayılan olarak kapalı): Jump List görevleri, masaüstü kısayolları, `evpaneli://` bağlantıları, 127.0.0.1 üzerinde yerel API, bilgisayar olayları (kilit, uyku) ve toplantı ışığı. Yalnız adıyla seçtiğin zararsız favorileri çalıştırırlar.
- İstersen Home Assistant mobil uygulaması olarak kayıt: `notify.mobile_app_*` bildirimleri düğmeleriyle bilgisayarına gelir.
- Zor kurulumlar için bağlantı seçenekleri: özel HTTP üstbilgileri (örneğin Cloudflare Access), özel kök sertifika ya da sabitlenmiş sertifika, tarayıcıyla giriş ve seçtiğin bir klasör üzerinden ayar eşitleme.
- Açık, koyu ve yüksek karşıtlıklı tema; hazır ya da özel renkler, metin boyutu, Windows 11 mika/akrilik görünüm; Türkçe, İngilizce, Almanca, Fransızca ve İspanyolca arayüz.
- Solda kategorilere ayrılmış Ayarlar (Bağlantı, Favoriler, Görünüm ve diğerleri); arama hepsinde arar. Ayarları dışa/içe aktarma ve otomatik yedekler, sır içermeyen tanılama raporu; sürüm denetimi ve uygulama içi güncelleme varsayılan olarak kapalıdır. İçe aktarma, uygulanmadan önce bir önizleme gösterir.
- Kurulum gerektirmeyen taşınabilir sürüm.

## Ekran görüntüleri

Tüm ekran görüntüleri gerçek bir evle değil, uydurma bir örnek evle çekildi.

<table>
<tr>
<td align="center" valign="top"><img src="docs/screenshots/quick-panel.png" width="240" alt="Saat, hava durumu, çalan parça şeridi ve ışık satırlarıyla hızlı panel"><br><sub>Hızlı panel</sub></td>
<td align="center" valign="top"><img src="docs/screenshots/lights.png" width="240" alt="Hazır seviyeler, kaydırıcı ve beyaz tonuyla bir ışığın ayrıntısı"><br><sub>Işıklar</sub></td>
<td align="center" valign="top"><img src="docs/screenshots/climate-fan.png" width="240" alt="Klima ve vantilatör kartları"><br><sub>Klima ve vantilatör</sub></td>
</tr>
<tr>
<td align="center" valign="top"><img src="docs/screenshots/sensors-forecast.png" width="240" alt="Hava tahmini ve sensör şeridi"><br><sub>Tahmin ve sensörler</sub></td>
<td align="center" valign="top"><img src="docs/screenshots/todo-calendar.png" width="240" alt="Yapılacaklar listesi ve yaklaşan etkinlikler"><br><sub>Yapılacaklar ve takvim</sub></td>
<td align="center" valign="top"><img src="docs/screenshots/notifications.png" width="240" alt="Paneldeki Home Assistant bildirimleri"><br><sub>Bildirimler</sub></td>
</tr>
<tr>
<td align="center" valign="top"><img src="docs/screenshots/pages.png" width="240" alt="Bir oda için özel sayfa"><br><sub>Sayfalar</sub></td>
<td align="center" valign="top"><img src="docs/screenshots/quick-panel-light.png" width="240" alt="Açık temada hızlı panel"><br><sub>Açık tema</sub></td>
</tr>
</table>

### Köşe bildirimi

<p><img src="docs/screenshots/corner-notification.png" width="320" alt="Köşe bildirimi: Desk Lamp, parlaklık %60"><br>
<img src="docs/screenshots/corner-notification-off.png" width="320" alt="Köşe bildirimi: Coffee Machine kapatıldı"></p>

### Komut paleti

<img src="docs/screenshots/palette.png" width="480" alt="Favorileri listeleyen komut paleti">

<details>
<summary>Daha fazla palet örneği</summary>

<p><img src="docs/screenshots/palette-search.png" width="480" alt="Palette living araması"><br><sub>Cihaz, sahne ve sayfalarda arama</sub></p>
<p><img src="docs/screenshots/palette-brightness.png" width="480" alt="desk 40 masa lambasını yüzde 40 yapar"><br><sub><code>desk 40</code> ışığı %40 yapar</sub></p>
<p><img src="docs/screenshots/palette-climate.png" width="480" alt="ac 21 klimayı 21 dereceye ayarlar"><br><sub><code>ac 21</code> hedef sıcaklığı ayarlar</sub></p>
<p><img src="docs/screenshots/palette-delayed.png" width="480" alt="desk off in 10 min bir eylemi zamanlar"><br><sub><code>desk off in 10 min</code> bir eylemi zamanlar</sub></p>
<p><img src="docs/screenshots/palette-recent.png" width="480" alt="@ işareti son değişenleri listeler"><br><sub><code>@</code> son değişenleri listeler</sub></p>
<p><img src="docs/screenshots/palette-light.png" width="480" alt="Açık temada komut paleti"><br><sub>Açık tema</sub></p>

</details>

<details>
<summary>Ayarlar</summary>

<p><img src="docs/screenshots/settings-connection.png" width="560" alt="Bağlantı ayarları"><br><sub>Bağlantı</sub></p>
<p><img src="docs/screenshots/settings-favorites.png" width="560" alt="Favoriler ve güvenlik kuralı"><br><sub>Favoriler ve güvenlik kuralı</sub></p>
<p><img src="docs/screenshots/settings-appearance.png" width="560" alt="Görünüm ve dil ayarları"><br><sub>Görünüm ve dil</sub></p>

</details>

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
