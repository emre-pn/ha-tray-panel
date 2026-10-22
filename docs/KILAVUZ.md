# Ev Paneli — Ayrıntılı Kılavuz (Türkçe)

> Kısa tanıtım, kurulum ve katkı için ana [README](../README.md); sürüm notları için [CHANGELOG](../CHANGELOG.md).

**Ev Paneli**, Windows 11 üzerinde çalışan, Home Assistant ev otomasyonunuzu doğrudan masaüstünüzden yönetmenizi sağlayan hızlı kontrol ve tepsi (system tray) uygulamasıdır.

Bu belge koddaki gerçek davranışı anlatır. Gerçek Windows'ta henüz denenmemiş şeyler **denenmedi** diye işaretlidir; elle denenecekler en altta ve ["Senin elle yapacakların"](#-önerilen-elle-ayarlar-ve-denemeler) bölümünde toplanmıştır.

---

## 🌟 Temel Özellikler

- **Çift Adres ve Akıllı Yönlendirme:** 
  - Ev içi adres (öncelikli): `http://192.168.1.10:8123` (evde de HTTPS adresiniz varsa onu yazın; bkz. [HTTPS](#-önerilen-elle-ayarlar-ve-denemeler))
  - Dış adres (yedek): `https://ha.example.com`
  - Açılışta önce ev içi adresi dener; 3 saniye içinde yanıt alamazsa otomatik olarak dış adrese bağlanır.
  - Hangi adresle bağlı olduğunu pencere başlığında gösterir (`Ev ağı` veya `İnternet üzerinden`).
- **Oturum (`persist:ha`) ADRES BAŞINADIR:**
  - Home Assistant oturumu (çerezler, LocalStorage) uygulamanın kendi kalıcı bölümünde diske yazılır; uygulama kapanıp açılsa da giriş silinmez.
  - Tarayıcı oturumu **köken (adres) başınadır**: ev içi adres (`http://192.168.1.10:8123`) ile dış adres (`https://ha.example.com`) farklı kökenlerdir. Bu yüzden **her adreste ayrı giriş yapmanız gerekir** (örneğin ilk kez ev dışından bağlandığınızda giriş ekranı yeniden çıkar) ve HA'nın cihaza özel tarayıcı ayarları (ör. kenar çubuğunu gizleme) da adres başına ayrı tutulur. Ev içi adresi başka bir adresle değiştirirseniz o adreste yeniden giriş gerekir.
  - Erişim anahtarı (tepsi menüsü, hızlı panel, palet ve canlı durum için) bu tarayıcı oturumundan bağımsızdır, tek bir anahtardır ve hangi adrese bağlıysanız ona gider.
- **Sistem Tepsisi Entegrasyonu & Arka Planda Çalışma:**
  - Kapatma (**X**) düğmesine basıldığında uygulama kapanmaz, Windows bildirim alanına (tepsiye) küçülür. İlk gizlemede bir kez bilgilendirme bildirimi çıkar (bkz. aşağıdaki "Tepsi ipucu ve simge").
  - Uygulamadan tamamen çıkış yalnızca tepsi simgesine sağ tıklayıp **"Çıkış"** denilerek yapılır.
  - Tek kopya koruması: İkinci kez çalıştırıldığında yeni bir kopya açılmaz, mevcut pencere öne getirilir.
- **Tepsi İpucu ve Simge (Dalga 4):**
  - Tepsi simgesinin üzerine gelince ipucu yazar: `Ev Paneli — Ev ağı — 2 ışık açık` (sayı yalnız **favori ışıklardan açık olanları** sayar; anahtar, priz, sahne, düğme sayılmaz; kapı ışığı zaten favori olamaz). Canlı bağlantı yokken durum REST ile en çok 1 dk eski gelir; o da başarısız olursa `(son bilinen)` notu düşülür. Açık ışık yoksa sayı yazılmaz. Geliştirme sürümünde `Ev Paneli [geliştirme] — …` yazar. Windows ipucu sınırı (120 karakter) aşılmaz.
  - Home Assistant'a hiçbir adrese bağlı değilken (açılışta bağlanırken ya da bağlantı yokken) tepsi simgesi **soluk** (gri tonlu, yarı saydam) gösterilir; bağlanınca normale döner. Soluk simge dosyaları (`assets/ikon-soluk.png`, `assets/ikon-soluk.ico`) yoksa normal simge kullanılır, simge hiçbir zaman kaybolmaz.
  - **Windows 11 taşma alanı:** Yeni tepsi simgeleri görev çubuğundaki `^` okunun altında (gizli simgeler) başlayabilir; simge görünür alana sürüklenmezse ipucu, soluk simge ve tıkla-aç davranışının hiçbiri görünmez. İlk gizlemede çıkan bildirim bunu söyler: *"simgeyi görev çubuğundaki ^ okundan görünür alana sürükleyin"*. Simgenin taşma alanındayken gerçekte nasıl davrandığı (özellikle `Tray.getBounds()` ile panel konumu) **denenmedi**.
- **Genel Kısayol Tuşu:**
  - `Ctrl + Alt + H` (veya ayarlardan belirleyeceğiniz tuş kombinasyonu) ile pencereyi her an gösterip gizleyebilirsiniz.
  - **Gizleme koşulu:** kısayol (ve tepsi simgesine tıklama) pencereyi YALNIZ pencere hem **görünür hem odaktaysa** gizler. Pencere görünür ama başka bir pencerenin arkasındaysa ya da simge durumundaysa gizlemez, öne getirip odaklar. Tepsi tıklamasında, odak kaybıyla az önce kendiliğinden gizlenen pencere "odaktaydı" sayılır (tıklama gizleme niyetidir, pencere geri açılmaz).
  - Kısayol başka bir uygulama tarafından kullanılıyorsa kaydedilemez; Ayarlar nedenini söyler ve önceki kısayol korunur. Kurulu ve geliştirme kopyaları aynı kısayolu birlikte alamaz (ikincisi uyarı verir).
- **Pencere Boyutu ve Konumu:**
  - Pencere her açılışta **fare imlecinin bulunduğu monitörde** ortalanır; konum saklanmaz.
  - İki boyut modu vardır: **hızlı** (560 × 780, HA'nın dar düzeni) ve **geniş** (1280 × 820). Her modun son boyutu ayrı hatırlanır. Geniş modun yalnız **büyütülmüş (maximize) durumu** hatırlanır.
  - **Tam ekran (`F11`) durumu hatırlanmaz:** uygulama her açılışta normal pencereyle başlar; tam ekrandayken boyut ya da konum kaydedilmez ve pencere yeniden yerleştirilmez, tam ekrandan çıkınca eski boyuta dönülür.
  - **Başka yere tıklayınca gizle** (varsayılan açık, Ayarlar > Pencere Davranışı): pencere odağı kaybedince yaklaşık 0,2 sn sonra gizlenir. Tam ekranda, simge durumunda, Ayarlar penceresi / HA'nın açtığı alt pencere / geliştirici araçları odaktayken ya da bir onay penceresi açıkken gizlenmez.
  - **Uzun gizli kalma:** Ayarlar'daki süreden (varsayılan 5 dk, 0 = hiç) uzun gizli kaldıysa gösterirken ana panoya döner; kısa aralarda kaldığı yerden devam eder.
- **Çevrimdışı ve Bağlantı Hatası Sayfası:**
  - Sunucuya erişilemediğinde Türkçe hata ekranı gösterilir, otomatik deneme artan beklemeyle çalışır (2, 4, 8, 15, sonra en çok 30 sn) ve manuel "Tekrar Dene" düğmesi sunulur. Uyanışta ve ekran kilidi açılışında beklemeden yeniden denenir.
  - Pencere içi kısayollar: `Ctrl + R` / `F5` yenile, `Ctrl + Shift + R` önbelleksiz yenile, `F11` tam ekran, `Ctrl + W` gizle, `Ctrl + +` / `Ctrl + -` / `Ctrl + 0` yakınlaştırma (kalıcı), `Alt + ←` / `Alt + →` geri / ileri, `Ctrl + Shift + G` hızlı / geniş boyut.
- **Hızlı Panel (tepsi simgesine sol tık):**
  - Tepsi simgesine sol tıklayınca, simgenin yanında küçük bir panel açılır: ışıklar (hazır parlaklık seviyeleri ve kaydırıcı), sahneler, ekranı kapat, medya (oynat/duraklat, ses −/+, sessiz) ve "Son kullanılanlar" satırı. Zararsız eylemler tek tıkla çalışır; PC kapat gibi onay isteyen eylemler düğmeyi yaklaşık 0,8 sn **basılı tutmayı** ister (**basılı tutarak onay**: düz tıklama hiçbir şey göndermez, süre dolmadan bırakmak, imleci dışarı çıkarmak ya da pencerenin odak kaybetmesi isteği iptal eder). Panel, Home Assistant sayfası açılmadan çalışır; dışarı tıklayınca ya da tekrar tıklayınca kapanır.
  - Eski davranış (sol tıkla Home Assistant penceresi) isterseniz Ayarlar > Hızlı Panel ve Komut Paleti > "Tepsi simgesine sol tık" ile geri gelir. Sağ tık her zaman tepsi menüsüdür.
- **Komut Paleti (`Ctrl + Alt + P`):**
  - Yazarak ara, Enter ile çalıştır: "isik" yazınca Türkçe harf farkı gözetilmeden *Işık* bulunur; "ışık 40" gibi bir komut parlaklık seviyesini de verir (yalnız parlaklık ayarı açık ışıklarda). Ok tuşları seçer, Shift+Enter ışık seviyesi seçer, Esc kapatır. Onay isteyen eylemler için Enter'ı basılı tutun. Kısayol Ayarlar'dan değiştirilir ya da boş bırakılarak kapatılır.
  - Palette serbest metin gönderilmez: yalnız kayıtlı favoriler aranır (HA'nın konuşma özelliğine yazı göndermek kapı kuralını dolanabilirdi).
- **Son Kullanılanlar:**
  - Panel ve paletten çalıştırılan zararsız eylemler "Son kullanılanlar" satırında (palette en çok 5) görünür; yalnız varlık kimliği ve zamanı `son-kullanilanlar.json` dosyasında saklanır. Kapı kuralından geçmeyen hiçbir varlık oraya girmez.
- **Canlı Durum:**
  - Ana süreçte tek WebSocket bağlantısı Home Assistant'tan durum değişimlerini anında alır; panel, palet ve tepsi menüsü aynı durum deposunu gösterir. Bağlantı kurulamazsa ya da kopunca durumlar REST ile 60 sn'de bir yenilenir (yedek mod; bağlantı sürekli yeniden denenir). Erişim anahtarı yalnız bağlantının kimlik doğrulama iletisinde gider. Ayarlar'dan kapatılabilir.
- **Eylem Kısayolları, Panolar ve Komut Satırı:**
  - Her zararsız favoriye (Ayarlar'da satırın altındaki "Kısayol" kutusu) genel kısayol atanabilir; yıkıcı (onay isteyen) eylemler ve kapı/kilit kısayola atanamaz. Pano kısayolları (en çok 6) Home Assistant penceresini açıp belirttiğiniz panoya gider (ör. `/energy`); panolar tepsi menüsünde "Panolar" altında da listelenir.
  - `"Ev Paneli.exe" --eylem="Salon lambası"` komutu (Görev Zamanlayıcı, Stream Deck, PowerShell...) pencere açmadan eylemi çalıştırır; ad yalnız güvenli favoriler arasında aranır, belirsiz ya da bulunamayan ad hiçbir şey çalıştırmaz, onay isteyen eylemler komut satırından hiç çalışmaz. `--eylem="led 40"` (ya da `--eylem led 40`, `--eylem="led %40"`) parlaklık verir; `led 0` ışığı kapatır (yalnız `turn_off`). Anlaşılmayan `--eylem` pencere açmaz, köşede ve Windows bildiriminde hata gösterir. Uygulama kapalıyken komut onu gizli başlatıp eylemi çalıştırır.
- **Tepsi Hızlı İşlemleri (Favoriler):**
  - Pencereyi açmadan doğrudan tepsi sağ tık menüsünden ışık, priz, vantilatör, sahne ve scriptleri kontrol edin. İlk 8 zararsız favori menünün üst düzeyindedir (tek tık); kalanlar "Diğer favoriler", onay isteyenler "Onaylı eylemler", ayarlı panolar "Panolar" altındadır.
  - Sonuç anında, ekranın sağ altında odağı çalmayan kısa bir **köşe bildirimi** ile gösterilir (örn: *"Tavan lambası açıldı"*; Ayarlar > Geri Bildirim'den kapatılabilir). İsteğe bağlı kısa bip sesi vardır. **Windows bildirimi yalnızca hata olduğunda** çıkar (örn: *"Yapılamadı: bağlantı yok"*).
  - PC kapatma, yeniden başlatma, PowerShell, "İyi geceler" gibi geri alınması zor eylemler tepsi menüsünde ("Onaylı eylemler" altında) **"— onay ister"** etiketiyle görünür ve çalıştırmadan önce onay penceresi sorar (varsayılan seçenek *Vazgeç*). Yeni eklenen düğme ve scriptler varsayılan olarak onaylıdır; Ayarlar'da satır başına "Onay iste" kutusuyla değiştirilebilir (PC kapat gibi eylemlerde kapatılamaz).
- **Windows 11 Görünümü (Dalga 4, yalnız yeni küçük pencereler):**
  - **Malzeme:** Hızlı panel, komut paleti ve köşe bildirimi Windows 11'de **Akrilik** (varsayılan, yarı saydam bulanık), **Mica** ya da **Düz (opak koyu)** malzemeyle açılır (Ayarlar > Görünüm). `transparent` pencere kullanılmaz (gölge ve büyütme sorunları). Windows 11 22H2'den eski sürümlerde (yapı numarası < 22621) ve Windows 10'da malzeme otomatik "Düz" olur, Ayarlar nedenini söyler. Akrilik/Mica görsel sonucu ve `backgroundColor` saydamlığının beklendiği gibi çalışıp çalışmadığı **denenmedi**: pencere opak ya da siyah görünürse **Düz (opak)** seçin.
  - **Ana Home Assistant penceresine malzeme uygulanmaz** (HA arayüzü zaten opaktır; kazanç küçüktür).
  - **Koyu tema:** Varsayılan "Her zaman koyu": Electron'un `nativeTheme.themeSource` değeri koyuya alınır (başlık çubuğu ve Electron'un çizdiği arayüzler için). Başlık çubuğunun gerçekten koyulaşıp koyulaşmadığı **denenmedi**. **Yan etki:** Home Assistant profilinizde tema "otomatik" ise HA de koyu görünür. "Windows temasını izle" seçilirse eski davranış döner. **Özel başlık çubuğu yoktur** (HA sayfasına sürükleme alanı eklemek kırılgandır; HA güncellenince bozulabilir).
  - **Vurgu rengi:** Ayarlar > Görünüm'de `#rrggbb` yazılırsa ana pencerenin ve Ayarlar penceresinin kenarlık vurgu rengi o olur (`setAccentColor`); boşsa Windows'un vurgu rengi kullanılır. Geçersiz değer kaydedilmez, önceki renk korunur (diğer ayarlar yine kaydedilir).
- **Geliştirme Sürümü Ayrımı:**
  - `npm start` ile açılan kopya başlığında ve tepsi ipucunda `[geliştirme]` yazar. Verilerini kurulu sürümden **ayrı bir kullanıcı klasöründe** (`%APPDATA%\Ev Paneli (gelistirme)\`: ayar, anahtar, günlük, oturum) ve kendi tek-kopya kilidiyle tutar. Kurulu sürümle aynı anda çalışabilir ve kurulu sürümün ayarlarına, anahtarına, oturumuna dokunmaz. Geliştirme sürümünde erişim anahtarını ve Home Assistant girişini ayrıca yapmanız gerekir.
- **Yüksek Güvenlik Mimarisi:**
  - `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`.
  - Gezinme sadece izin verilen iki kökenle (yerel IP ve dış alan adı) sınırlıdır; harici bağlantılar varsayılan tarayıcınızda açılır.
  - Kamera, mikrofon ve konum izinleri engellenir; yalnızca iki HA kökeni için bildirim izni verilir.
  - **Kapı Kuralı:** Aşağıdaki ["Kapı Kuralı"](#-kapı-kuralı) bölümüne bakın.
  - HA Uzun Ömürlü Erişim Anahtarı kodda veya düz metin dosyada **durmaz**. Windows `safeStorage` (DPAPI, asenkron API) ile şifrelenir, dosyaya atomik yazılır ve renderer süreçlerine asla iletilmez. Anahtarı Ayarlar'dan silmek yalnız bu bilgisayardaki dosyayı siler; HA'daki anahtar iptal edilmez (HA profilinizden ayrıca silin).
  - **Yetki kesici (1.1.1):** Home Assistant bir erişim anahtarını reddederse (REST 401 ya da canlı bağlantıda `auth_invalid`) o anahtarla hiçbir adrese hiçbir kimlikli istek gönderilmez (tepsi favorileri, panel, palet, kısayollar, `--eylem`, canlı bağlantı, yoklamalar dahil; yeniden başlatınca da). Açılışta, adres ya da anahtar değişince kimlikli toplu isteklerden ve canlı bağlantıdan önce **tam bir** doğrulama isteği (`GET /api/`; yanıt 200 ve `API running.` olmalı) gider, diğer çağrılar onu bekler. Kimlikli her ağ işlemi (REST ve canlı bağlantının kimlik doğrulaması) tek kapıdan geçer ve aynı anda **en çok 1 kimlikli işlem** yolda olur; geçersiz anahtar başına Home Assistant'a **en çok 1 hatalı deneme** gider (tek istisna: yanıtın istemciye hiç ulaşmadığı belirsiz durumlar, aşağıya bakın). Durum tepside (ipucu ve menü), hızlı panelin üstünde ve Ayarlar'da görünür; Windows bildirimi anahtar başına bir kez çıkar. Kimlikli istekte 403 (Home Assistant ban'ı ya da Cloudflare engeli) anahtarı geçersiz saymaz ama o adrese kimlikli istekleri 15 dk durdurur; 401/403 adres değiştirme nedeni değildir (adres yalnız ağ hatası/zaman aşımında değişir).
  - Yerel sayfalar (Ayarlar, bağlantı sayfası, köşe bildirimi, hızlı panel/palet) katı CSP'li (`script-src 'self'`), satır içi betiksizdir ve metni yalnız `textContent` ile yazar; köprü (`window.evPaneli`, `window.evYuzey`) yalnız yerel (`file:`) sayfalara açılır, uzak HA sayfası onu görmez. Renderer eylemi "onaylı" diye bildiremez; onay kararı ana süreçte verilir.
  - Ev içi adres `http://` ya da `https://` olabilir (https'te sertifika normal doğrulanır); `http://` yalnız ev ağı adreslerinde kabul edilir (192.168.x.x, 10.x.x.x, 172.16-31.x.x, Tailscale `100.64.0.0/10` (100.64.x.x - 100.127.x.x; 1.2.0; aşağıdaki Tailscale notuna bakın), `.local`, `.lan`, `localhost`, tek etiketli adlar). Herkese açık bir ada düz `http://` ile ne yoklama ne erişim anahtarı gider; Ayarlar'da kaydedilmez. Adres yoklaması yanıtın gerçekten Home Assistant olduğunu içerikten doğrular ve yönlendirmeyi izlemez (`http` -> `https` yönlendiren bir adres seçilmez; adresi doğrudan `https://` yazın); ağdaki başka bir cihaz (yönlendirici, yazıcı) seçilmez ve ona erişim anahtarı gönderilmez. Ev içi adres `http://` iken ve anahtar kayıtlıyken açılışta günlüğe sabit bir not yazılır ve (adres başına bir kez) Windows bildirimi gösterilir: anahtar ev ağında şifresiz gider; kök çözüm evde de HTTPS adres kullanmaktır.
  - **Tailscale ve düz `http://` (1.2.0):** `100.64.0.0/10` aralığı RFC 6598 paylaşılan adres alanıdır; internet sağlayıcılarının ve mobil erişim noktalarının CGNAT ağı da bu aralığı kullanır. Tailscale açıkken trafik şifreli tünelden gider; Tailscale kapalıyken ya da bağlantısı kopukken aynı `http://100.x.x.x` adresi tünel yerine taşıyıcı ağına yönlenebilir ve erişim anahtarı şifresiz gider (yabancı Wi-Fi'deki özel IP adresleriyle aynı risk sınıfı; anahtar yalnız içeriği doğrulanan anahtarsız bir yoklamadan sonra gider, ama o yoklama taklit edilebilir). Mümkünse Tailscale için de `https://` kullanın (ör. MagicDNS adı ve Tailscale sertifikası). Böyle bir `http://` ev içi adres kayıtlıyken ve anahtar varsa açılış uyarısı (yukarıda) bu adres için de çıkar.
  - **Adres tazeleme (1.2.0):** Ana pencerenin açık olduğu adres anahtarlı istekler için en çok 5 dk yoklamasız kullanılır; sonra (ve canlı bağlantı koptuğunda) adres önce **anahtarsız** yoklanır, ağ uykusuz değişse de anahtar eski IP'deki başka bir cihaza gitmez. Ana pencere dış adresteyken ev içi adres 3 dk'da bir yalnız anahtarsız yoklanır; yeniden ulaşılabilirse (pencere o an kullanılmıyorsa) ev içi adrese dönülür. HA kapalıyken her istek adresleri bir kez yoklar. Anahtar az önce doğrulanmışken uzun süren bir sahnenin yanıtı 8 sn'yi aşarsa "komut gönderildi, yanıt gecikti" denir ve diğer eylemler 30 sn durmaz (deneme yetki kesicide yine askıda sayılır; sonraki istek önce adresi anahtarsız yoklar, sonra tek doğrulamayla gider: ağ bu arada değişmişse anahtar doğrulanmamış bir adrese gitmez).

---

## 🚪 Kapı Kuralı

Kapı, kilit, alarm, garaj, bariyer ve geçit (gate) varlıkları **hiçbir yüzeyde** yer almaz ve uygulama **hiçbir kapıyı kendiliğinden açmaz**. Kapılar yalnızca Home Assistant'ın kendi arayüzündeki onaylı karttan açılır.

- **Nerelerde geçerli:** Favoriler (Ayarlar cihaz listesi dahil), hazır ilk liste, tepsi menüsü, hızlı panel, komut paleti, eylem kısayolları, `--eylem` komut satırı, "Son kullanılanlar" listesi ve tepsi ipucundaki açık ışık sayısı. Hepsi aynı süzgeçten (`src/lib/suzgec.js`) geçer; kural çalıştırma anında HA'daki **güncel** adla yeniden uygulanır.
- **Neler engellenir:** `lock`, `alarm_control_panel` ve `siren` alanları; cihaz sınıfı `door`, `garage_door`, `garage`, `gate`, `lock` olanlar (büyük/küçük harf fark etmez: `Door` da); kimliğinde ya da adında *"kapi", "kapı", "door", "kilit", "lock", "alarm", "garaj", "bariyer", "gate", "diafon", "interkom", "intercom", "kepenk", "deadbolt", "latch", "buzzer", "yale", "shutter", "siren"* geçen her varlık (1.2.0: diafon, interkom, kepenk gibi kapıyı gerçekten açan adlar eklendi; 1.4.0: siren; masum adları da engelleyeceği için "giriş"/"entrance" bilerek eklenmedi). Sözcükler bitişik de engellenir (`MainGate`, `Keylock`, `smartgateopener`, `kapisi`; yalnız `navigate`, `clock`, `block` gibi bilinen masum sözcükler geçer), Türkçe ek almış `kilidi / kilide` ve `kepengi / kepenge` ("kepeng") biçimleri de ("Kilidi aç" script'i dahil). Yazım kandırmacaları da yakalanır: tam genişlikli, matematik/daire/kare harfler, görünmez karakterle bölünmüş sözcükler ve Kiril/Yunan benzer harfler; Latin dışı yazı sistemiyle yazılmış (ör. Kiril, CJK) adlar güvenlik için engellenir.
- **Almanca, Fransızca, İspanyolca sözcükler:** Arayüz bu dillerde de kullanılabildiği için kapıyı açan adlar bu dillerde de engellenir: *Tür / Tor / Schloss / Klingel / Gegensprechanlage / Schranke / Rollladen* (`Türöffner`, `Haustür`, `Hoftor`, `Rolltor` gibi birleşikler dahil), *porte / portail / serrure / verrou / interphone / sonnette / barrière / volet* (`Porte d'entrée`, `portier` dahil), *puerta / portón / cerradura / cerrojo / cancela / portero / timbre / barrera / persiana*. Kısa ve başka anlamı olan sözcükler (`tor`, `tur`, `cancela`, `verja`) yalnız tam sözcük olarak, `porte` ve `timbre` sözcük başı olarak aranır; `Porter Lampe` ya da `Tormenta` gibi ilgisiz adlar engellenmez. Kural yalnız sıkılaşır; Türkçe ve İngilizce sözcükler eskisi gibi engelli kalır.
- **Tek istisna:** `indoor` / `outdoor` (ve `indoors` / `outdoors`) sözcükleri ("outdoor ışık" yanlışlıkla engellenmesin). `frontdoor`, `doorbell`, `outdoorlight` gibi her `door` içeren başka sözcük engelli kalır.
- **Yan etki (bilinçli):** Adında `kilit` geçen **bilgisayar kilitleme** düğmesi/script'i de ("Bilgisayarı kilitle") kapı kilidinden ayırt edilemediği için favori, panel, palet ya da kısayol olamaz. Kuralı gevşetmek için kod değişikliği ve ayrı karar gerekir; ayarla açılamaz.
- **Perde, vana, otomasyon ve kamera (1.4.0):** `cover` alanı yalnız cihaz sınıfı tam olarak `curtain`, `blind`, `shade` ya da `awning` olduğunda ve adında yukarıdaki sözcüklerden biri geçmediğinde geçer (sınıfı boş, bilinmeyen ya da büyük harfli olan, garaj, kapı, kepenk, geçit ve pencere sınıfları geçmez); perde karosu HA'daki canlı durum olmadan görünmez. `valve` ve `automation` varlıkları **zorunlu onaylıdır**: panel ve palette yaklaşık 0,8 sn basılı tutma, tepsi menüsünde onay penceresi gerekir; kısayol, komut satırı ve masaüstü karosundan hiç çalışmazlar ve favoride `onay: false` bunu kaldırmaz. `camera` alanı hiçbir yüzeyde karo olmaz; yalnız Ayarlar > Kamera'da tek tek onaylanan en çok 8 kameranın son anlık görüntüsü hızlı panelin en altında gösterilir. Kapı, zil, diafon, giriş (`giris`, `entrance`, `entry`, `eingang`, `lobby`...), ziyaretçi adlı kameralar (ve marka/model metni bunları söyleyenler) listeye hiç gelmez ve onaylansa da çekilmez. Görüntü anahtarlı korumalı bir `GET /api/camera_proxy/<kamera>` ile ana süreçte çekilir, renderer'a `data:` URL olarak verilir, diske yazılmaz, panel gizlenince silinir; kamera başına en sık 5 sn'de bir, toplamda dakikada en çok 20 çekim yapılır; en çok 2 MB ve JPEG/PNG/WebP/GIF imzası taşımayan içerik reddedilir; görüntü varsayılan bulanıktır; bir kameraya izin verilmişken panel ve palet penceresi ekran görüntüsünden/kaydından gizlenir (`setContentProtection`). Kamera izin listesi (`kameraIzinleri`) dışa/içe aktarılmaz.
- **Yeni yüzeyler (1.4.0):** Aynı kural geri al, gecikmeli eylem, "odayı kapat", etkinlik geçmişi, palette "@" ve "*" listeleri, tepsi orta tıkı, bildirim düğmeleri, kamera listesi, yerel API, `evpaneli://`, Jump List, masaüstü kısayolu, PC olayları, toplantı ışığı ve klasörle eşitlemeden gelen içe aktarma için de geçerlidir; hiçbiri kuralı gevşetmez, yalnız sıkılaştırır. Kapı, kilit, alarm, siren, garaj ve kepenk adı ya da kimliği taşıyan bir bildirim metni, bildirim düğmesi, PC olayı kuralı ya da eşitlenen favori hiçbir yüzeye girmez. Perde (`cover`), vana, otomasyon ve kamera dış tetiklerden hiçbir koşulda çalıştırılamaz. Tepsi rozeti için seçilen ek sensörler (en çok 2) de yalnız `sensor` alanı olabilir ve çizimde aynı süzgeçten geçer.
- **Sahne üyeleri (1.2.0):** Home Assistant sahnenin (ya da ışık/anahtar grubunun) durumunda üye listesi (`attributes.entity_id`) veriyorsa her üye de aynı kuraldan geçer: üyelerden biri `lock`, `alarm_control_panel` ya da `cover` (kepenk/kapı/perde; sahne üyesinin cihaz sınıfı bilinmediğinden perde de dahil) alanındaysa ya da kimliğinde yukarıdaki sözcüklerden biri geçiyorsa sahnenin tamamı engellenir. Üye listesi yoksa sahne eskisi gibi yalnız kendi adıyla denetlenir.
- **Kapsam dışı:** Bir script'in *içeriği* ve üye listesi vermeyen sahnenin içeriği denetlenmez; üyelerin yalnız kimliğine bakılır (adı kimliğinden farklı bir kapı rölesi yakalanmaz): içinde kapı/kilit çağıran script veya sahneyi favoriye koymayın (Ayarlar'da script/sahne satırlarında bu uyarı yazar).

---

## 🧩 1.4.0 Yeni Ayarlar ve Dış Tetikler

Ayar şeması 6 olarak kalır; yalnız yeni alanlar eklendi (1.3.0'a dönülürse yedekten geri alınır, bkz. CHANGELOG). **Uygulamanın dışına açılan her şey (dış tetikler, yerel API, `evpaneli://`, mobil bildirim kaydı, uygulama içi güncelleme, klasörle eşitleme, kamera) varsayılan olarak KAPALIDIR** ve Ayarlar'dan tek tek açılır. Hiçbir yolda telemetri yoktur; Home Assistant adresi ve anahtarı üçüncü bir hizmete gitmez.

### Eylemler, geri al ve geçmiş (Ayarlar > Eylemler, geri al ve geçmiş)

- **Geri al (`geriAl`, açık; `geriAlSureDk` 1-60, varsayılan 10; `geriAlKisayolu` varsayılan `Ctrl+Alt+Z`):** Son en çok 5 zararsız eylem geri alınır: ışık/priz/vantilatör/sanal anahtar aç-kapa, ışık parlaklığı ve rengi, vantilatör hızı, sahnenin aç-kapa yapılabilen üyeleri. Yıkıcı (onaylı) eylem, düğme, script, iklim ve medya geri alınmaz. Kaydırıcıyı sürüklemek (5 sn içindeki değişiklikler) tek adımdır. Geri alma, eylemle AYNI güvenli hattan geçer (Kapı Kuralı, eylem sınıfı, servis izin listesi, hız sınırı).
- **Gecikmeli eylem (`gecikmeliEylem`, açık):** Palette `salon 10 dk sonra kapat`, `salon off in 10 min`, `fan 30dk` (şimdi aç, 30 dk sonra kapat). Süre 1 dk - 24 saat, en çok 10 bekleyen eylem; yalnız ışık, priz, vantilatör, sanal anahtar ve nem alıcı için yalnız aç/kapat. Bekleyenler yalnız bellektedir: uygulama kapanınca iptal olur, bilgisayar uykudayken çalışmaz, planlanan zamandan 2 dakikadan fazla geçmişse çalıştırılmaz ve söylenir. Çalışma anında Kapı Kuralı ve eylem sınıfı yeniden uygulanır.
- **Etkinlik geçmişi (`etkinlikGecmisi`, açık):** `%APPDATA%\Ev Paneli\etkinlik-gecmisi.json`, en çok 200 kayıt: zaman, kaynak (panel, palet, kısayol, tepsi menüsü, gecikmeli, geri al, odayı kapat, Jump List, kısayol dosyası, yerel API, protokol, PC olayı, toplantı ışığı, bildirim düğmesi), varlık, işlem ve sonuç. Parametre değeri, adres, anahtar ve HA hata metni yazılmaz; Kapı Kuralı'ndan geçmeyen kimlik ya da ad hiç yazılmaz. Dışa aktarılmaz, klasörle eşitlenmez, tanılama raporuna girmez.
- **Son değişenler (`sonDegisenler`, açık):** Palette `@` yazınca izlenen ışık, priz, sahne, klima ve medya oynatıcılarındaki son açma/kapama/mod değişiklikleri (en çok 20 satır) listelenir. Yalnız bellektedir.
- **Palette favori olmayan cihazlar (`paletDigerCihazlar`, KAPALI):** Bu seçenek "palette yalnız kayıtlı favoriler aranır" kararını **bilerek gevşetir**, bu yüzden varsayılan kapalıdır. Açıkken palette `*` yazınca HA'dan tek bir okuma isteği (`GET /api/states`) yapılır; liste 2 dakika bellekte tutulur, diske yazılmaz. Yalnız Kapı Kuralı'ndan geçen, zararsız ışık, priz, vantilatör, sanal anahtar, nem alıcı ve sahne gösterilir; script, düğme, otomasyon, vana, kamera, perde/kepenk, klima ve medya bu listeye hiç girmez. Kapalıyken HA'ya hiçbir istek gitmez.
- **Odaya göre gruplama (`panelGruplama`: `tur` ya da `oda`):** Karolar HA'daki alana (odaya) göre gruplanır; yalnız görünümdür, karo kümesi aynı kalır. Oda başlığındaki "Odayı kapat" yalnız o odadaki, şu an açık ve zararsız favorileri (ışık, priz, vantilatör, sanal anahtar, nem alıcı) kapatır; üye listesini her seferinde ana süreç yeniden hesaplar.
- **Panel etkileşimi:** `karoTekerlegi` (açık: ışık karosu ya da medya kartı üstünde tekerlek değeri değiştirir), `tepsiOrtaTik` (tepsi simgesine orta tıkta çalışan TEK zararsız favori; kısayolla aynı yoldan geçer), `panelSabit` (hızlı panel dışarı tıklayınca gizlenmez), `kisayolBasiliTut` (KAPALI: ana kısayol basılı tutulduğu sürece gösterir; klavye dinlenmez, yalnız genel kısayolun kendi tekrar olayları kullanılır; gerçek donanımda denenmedi), `baglantiBildirimi` ve `baglantiBildirimSn` (HA bu süreden uzun ulaşılamaz kalırsa "koptu / geri geldi" bildirimi). Ayarlar'daki anahtar bölümü, anahtarın bir YÖNETİCİ kullanıcıya ait olduğunu anlarsa uyarır; yönetici olmayan bir kullanıcıyla anahtar üretmen önerilir.

### Bilgi kartları ve medya (Ayarlar > Bilgi kartları ve sensörler)

- `havaTahmini` (`kapali`, `gunluk`, `saatlik`; varsayılan `gunluk`): hava kartının altında tahmin şeridi; panel açıkken HA'dan okunur.
- `birincilMedya`: üst "medya" kartının oynatıcısı (yalnız `media_player`, Kapı Kuralı'ndan geçer).
- `medyaKapagi` (açık): albüm kapağı yalnız ana süreçte, uygulamanın kendi HA bağlantısıyla ve yalnız HA'nın `/api/media_player_proxy/<aynı oynatıcı>` yolundan çekilir. Mutlak (dış) adres ASLA çekilmez, yani HA anahtarı dış sunucuya gitmez. Yalnız jpeg/png/webp, en çok 600 KB ve 4096 piksel kenar kabul edilir; renderer adres görmez, küçük bir `data:` adresi alır.
- Sensör favorileri özel panel sayfalarında da görünür; tepsi menüsündeki sayaç sabitlenen favorileri izler.

### Kartlar, karo menüsü ve rozet (1.4.0)

- **İklim, medya ve süpürge kartları:** İklim kartı, cihazın desteklediği kadarıyla ısıtma/soğutma aralığı (`target_temp_low/high`), fan modu ve hazır ayar sunar. Medya kartı 10 sn geri/ileri sarar (`media_seek`; yalnız cihaz destekliyorsa). Süpürge kartı yalnız cihazın desteklediği düğmeleri (başlat, duraklat, durdur, şarja dön) gösterir; cihaz özellik bit alanını bildirmiyorsa eski üç düğme (başlat, duraklat, şarja dön) kalır. Hepsi aynı servis izin listesinden ve Kapı Kuralı'ndan geçer; geri alınmazlar.
- **Sensör göstergesi (`gostergeMin`, `gostergeMax`, `grafikTuru`):** Sensör favorisi için gösterge aralığı (ikisi birden, en küçük < en büyük) ve grafik biçimi (`otomatik`, `cizgi`, `gosterge`, `yok`) seçilebilir; geçersiz değer sessizce atılır. Favori kaydında durur, klasörle eşitlenen "favoriler" bölümüne girer.
- **Palette panel sayfaları:** Palet özel panel sayfalarını da listeler; seçince hızlı panel o sayfada açılır. Yalnız sayfa seçer, eylem çalıştırmaz.
- **Karo menüsünden masaüstüne sabitle:** Sağ tık menüsündeki "Masaüstüne sabitle / Masaüstünden kaldır" `masaustuKarolari` ayarını değiştirir (Ayarlar'daki seçimle aynı liste). Öğe yalnız zararsız sınıftaki, Kapı Kuralı'ndan geçen ve kilit, alarm, kapı, perde ya da kamera olmayan karolarda görünür; liste dolunca "sabitle" öğesi çıkmaz. Yeni bir yetki eklemez ve düzen geçmişine (geri al) girmez.
- **Kamera kartı:** Büyüt düğmesi görüntüyü panel içinde büyütür; "Şimdi yenile" yeni kare ister. Her ikisi de aynı hız sınırına (en çok 5 sn'de bir), bulanık başlangıca ve bellek-yalnız kuralına tabidir; resim diske yazılmaz.
- **Emoji seçici (Ayarlar > Düzen):** Karo simgesi için aranabilir, kısa bir emoji listesi vardır; elle yazılan simge de aynı doğrulamadan geçer. Kapı, kilit, anahtar, siren, bariyer, geçit ve pencere emojileri listede yoktur ve elle yazılsa da kabul edilmez (Kapı Kuralı).
- **İçe aktarma önizlemesi:** Ayarlar dosyası seçilince ana süreç dosyayı okur ve yalnız bölüm adlarını ve sayıları (alan, favori, eksik favori, atılan) gösterir; sayfaya dosya yolu ya da içerik verilmez. "Uygula" tek kullanımlık, 10 dakika geçerli bir kodla çalışır; kod yoksa ya da süresi dolduysa hiçbir şey uygulanmaz. Uygulama, her zamanki içe aktarma denetimlerinden (Kapı Kuralı dahil) geçer.
- **Tepsi rozeti, çoklu sensör (`tepsiRozetSensorleri`):** Ana sensöre ek olarak en çok 2 sensör daha seçilebilir (toplam 3). Rozeti çizilebilen (sayısal, süzgeçten geçen, en çok üç karakter) sensörler 5 saniyede bir sırayla gösterilir; çizilemeyenler atlanır, tek sensör çizilebiliyorsa dönüş olmaz. Dönüş ağ isteği yapmaz; simge değişimi yine saniyede en çok bir kez yazılır. Tepsi ipucunda geçerli sensörlerin hepsi yazılır. Alan "bilgi" bölümüyle eşitlenir.

### Dış tetikler (Ayarlar > Dış tetikler)

Uygulamanın penceresi DIŞINDAN gelen her eylem tek bir kapıdan geçer ve sonra her zamanki tek güvenli eylem hattına girer. Kapı sırayla şunlara bakar: kaynağın seçeneği açık mı; kaynak başına ve genel hız sınırı (Jump List, kısayol dosyası ve `evpaneli://` 10 sn'de 6, yerel API 20, PC olayı 16, toplantı ışığı 4, genel dakikada 60); ad biçimi ve Kapı Kuralı metin süzgeci; ad **yalnız güvenli favoriler arasında** çözülür (belirsizse hiçbiri çalışmaz); favori zararsız olmalı ve istenen servis onay istememeli. Hiçbir dış tetik valf, otomasyon, kamera, perde/kepenk (`cover`), kilit, alarm, siren, yapılacaklar listesi ya da klima kipi değişikliğini başlatamaz; favoride "onay iste" işaretli olan hiçbir şey dışarıdan çalışmaz. Kapıda durdurulan istekler (seçenek kapalı, izinsiz, belirsiz ya da reddedilen) etkinlik geçmişine kaynağıyla birlikte "atlandı" ya da "iptal" olarak yazılır. Bu bölümün hiçbir ayarı dışa aktarılmaz ya da klasörle eşitlenmez.

- **Jump List (`tetikJumpList`):** Görev çubuğu simgesine sağ tıklayınca uygun favoriler (en çok 10) listelenir; her biri `--eylem="<ad>" --kaynak=jumplist` ile açılır. Kapatınca menü Windows'un varsayılanına döner.
- **Masaüstü kısayolları (`tetikMasaustu`):** Ayarlar'dan bir favori için `.lnk` dosyası oluşturulur (`--kaynak=kisayol`); var olan bir dosyanın üzerine yazılmaz.
- **`evpaneli://` bağlantısı (`tetikProtokol`, `tetikProtokolIzinleri`):** Biçim `evpaneli://eylem?ad=<favori adı>`. Seçenek açılınca bu kullanıcı için (HKCU) bağlantı şeması kaydedilir, kapanınca ya da uygulamadan çıkılınca kaldırılır. Bir web sayfası da böyle bir bağlantı açabileceği için, her favori için hızlı panelde "İzin ver / Her zaman / Reddet" sorulur; aynı anda tek soru açıktır. "Her zaman" seçilenler `tetikProtokolIzinleri` listesinde (en çok 50) durur.
- **Yerel API (`tetikYerelApi`, `tetikApiPortu` varsayılan 48123, `tetikApiBildirim`):** Aynı bilgisayardaki betikler (Stream Deck, AutoHotkey, PowerShell) için. YALNIZ `127.0.0.1`'de dinler; Host başlığı `127.0.0.1:<port>` ya da `localhost:<port>` olmalıdır; `Origin` ya da `Sec-Fetch-*` başlığı olan (tarayıcıdan gelen) her istek reddedilir; CORS başlığı verilmez; yalnız `POST` ve `application/json`, gövde en çok 1 KB. `Authorization: Bearer <jeton>` gerekir; jeton rastgele 32 bayttır, `%APPDATA%\Ev Paneli\yerel-api-jetonu.dat` içinde `safeStorage` ile saklanır, günlüğe ya da yanıta yazılmaz, art arda yanlış denemede geçici kilit (429) gelir. Uçlar: `/eylem` (`ad`, isteğe bağlı `islem` = `ac`/`kapat`/`degistir`, `parlaklik` 0-100 ya da `adim`), `/durum` (`ad`) ve `/liste`. Eylemler yine yalnız adıyla seçilen zararsız favorilerdir. **Bilinen risk (bilerek kabul edildi):** 60 sn içinde 5 yanlış denemeden sonra gelen geçici kilit (429, 60 sn) İSTEMCİYE göre değil geneldir; aynı bilgisayardaki başka bir süreç bilerek yanlış jeton göndererek gerçek istemcinin (Stream Deck, betik) bir dakikalığına kilitlenmesine yol açabilir. Bu bir hizmet aksatma sorunudur, yetki vermez; jeton bilinmeden hiçbir eylem çalışmaz ve kilit kendiliğinden kalkar.
- **PC olayları (`tetikPcOlaylari`, `tetikPcAcma`, `tetikPcKurallari`):** Bilgisayar kilitlenince, kilit açılınca, uykuya geçince ve uyanınca en çok 8 kural çalışır (olay + favori + işlem). Varsayılan işlem `kapat`; `ac`, `calistir` ve `geriYukle` ayrıca "açma eylemlerine izin ver" (`tetikPcAcma`) ister. Kilit açılınca 1,5 sn, uyanışta 5 sn beklenir (ağ ve oturum otursun). `geriYukle`, kuralın değiştirdiği karonun önceki durumunu (açık/kapalı, parlaklık) bellekten geri kurar; bu bilgi diske yazılmaz ve 24 saat sonra unutulur. İlk kullanımda bir uyarı gösterilir.
- **Toplantı ışığı (`tetikToplanti`, `tetikToplantiKaynak`, `tetikToplantiFavori`, `tetikToplantiBitis`, `tetikToplantiBitisFavori`, `tetikToplantiAralik`):** Mikrofon ya da kamera kullanımdayken seçtiğin favori açılır/başlatılır, bitince eski haline döner, kapanır ya da başka bir favori çalışır. Windows'un kendi gizlilik kaydı (`HKCU\...\CapabilityAccessManager\ConsentStore`) YALNIZ OKUNUR; hangi uygulamanın kullandığı hiçbir yere yazılmaz. Yoklama aralığı 5-60 sn (varsayılan 10).

### Mobil bildirimler (Ayarlar > Mobil bildirimler, `mobilBildirimler`, `mobilCihazAdi`)

Bu bilgisayar, yalnız sen "Kaydol" deyip onaylarsan Home Assistant'a `mobile_app` cihazı olarak kaydolur (`POST /api/mobile_app/registrations`, tek istek, yeniden denenmez). Dönen webhook kimliği `%APPDATA%\Ev Paneli\mobil-kayit.dat` içinde `safeStorage` ile durur; ayara, günlüğe, dışa aktarmaya, klasörle eşitlemeye, hata iletisine ve tanılama raporuna girmez. `notify.mobile_app_<cihaz>` bildirimleri HA'nın itme kanalından (salt okunur WebSocket aboneliği) gelir; metin Kapı Kuralı'ndan geçer, geçmezse bildirimin tamamı gösterilmez. Düğmesiz bildirim Windows bildirimi, düğmeli bildirim (en çok 3 düğme) küçük bir kart olur. Düğmeye basınca HA'ya YALNIZ `mobile_app_notification_action` olayı gider (hız sınırı: 500 ms'de bir, dakikada 10); bağlantı açan ya da metin girişi isteyen düğmeler ile uzaktan komutlar (konum isteği, `command_*`) yok sayılır. **Hiçbir sensör, konum ya da cihaz durumu HA'ya gönderilmez.** "Kaydı sil" bu bilgisayardaki kaydı siler; HA'daki cihaz girdisini HA'dan (Ayarlar > Cihazlar ve hizmetler > Mobile App) kaldır. Basılan düğmeler etkinlik geçmişine "bildirim" kaynağıyla yazılır (düğme başlığı, eylem kimliği ve webhook kimliği yazılmaz). **Güvenlik notu:** düğmeye basınca HA tarafında hangi otomasyonun çalışacağı uygulama tarafından bilinemez ve denetlenemez (olayı HA otomasyonları dinler). Bu yüzden kapıyı, kilidi, garajı ya da alarmı açan bir otomasyonu `mobile_app_notification_action` olayına bağlamayın: bildirim düğmesi kanalı yalnız zararsız işler için düşünülmüştür.

### Sürüm denetimi ve uygulama içi güncelleme (Ayarlar > Sürüm ve yenilikler)

- `surumDenetimi` (KAPALI): günde en çok bir kez GitHub'dan en son sürümü sorar; adres ve anahtar gitmez, indirme yoktur.
- `uygulamaGuncelleme` (KAPALI) ve `onSurumler` (KAPALI): uygulama içi güncelleme AYRI bir izindir. Giden istekler yalnız GitHub Sürümleri'ne anahtarsız ve çerezsiz GET'tir; telemetri ve kullanıcıya özgü kimlik yoktur. Otomatik indirme ve çıkışta kurma kapalıdır: indirme "İndir" düğmesiyle, kurulum ayrıca bir onay penceresiyle başlar. Bilgi indirmeden önce doğrulanır (sürüm yalnız ileri gider, sha512 zorunlu, dosya adı düz ad, boyut sınırlı) ve indirilen dosyanın sha512'si indirmeden sonra ve kurmadan hemen önce yeniden hesaplanır. İmzasız kurucu için SmartScreen uyarısı yine çıkabilir.

### Bağlantı seçenekleri (Ayarlar > Bağlantı)

- **Özel üstbilgiler:** Home Assistant'ı Cloudflare Access gibi bir katman arkasında yayınlıyorsan her isteğe eklenecek üstbilgiler (en çok 8; örn. `CF-Access-Client-Id`, `CF-Access-Client-Secret`). Değerler anahtarla aynı muameleyi görür: `ozel-ustbilgiler.dat` içinde `safeStorage` ile durur; ayara, dışa aktarmaya, klasörle eşitlemeye, günlüğe ve tanılamaya girmez; Ayarlar sayfasına yalnız adlar gider. Üstbilgiler yalnız ayardaki iki HA köküne eklenir, yönlendirme izlenmez; `Authorization`, `Host`, `Cookie`, `Content-Type` gibi kimlik ve gövde üstbilgileri tanımlanamaz. "Üstbilgileri dene" düğmesi anahtarsız yoklamayla durumu ayırt eder (üstbilgisi eksik bir Cloudflare engeli de HA'nın 403'üne benzer ve yetki kesicinin 15 dakikalık adres duraklatmasını tetikleyebilir).
- **Sertifika güveni:** Özel sertifikalı bir adres için iki dar yol vardır, ikisi de YALNIZ Home Assistant ana bilgisayarına uygulanır: özel kök CA (en çok 4; zincir bu CA'ya çıkmalı, ad ve tarihler tutmalı) ya da sunucunun yaprak sertifikasının SHA-256 parmak izini sabitleme (en çok 4; aynı ana bilgisayar için başka her sertifika, sistem güvense bile reddedilir). Özel anahtar içeren dosya hiç okunmaz. "Sertifika hatalarını yok say" diye bir seçenek YOKTUR.
- **Tarayıcıyla giriş:** Uzun ömürlü anahtar yapıştırmak yerine tarayıcıda HA hesabınla giriş yaparsın (IndieAuth; bu bilgisayarda geçici bir yerel dinleyici, 5 dakika zaman aşımı). Yenileme anahtarı `oauth-oturum.dat` içinde `safeStorage` ile durur; erişim anahtarı (~30 dk) yalnız bellektedir ve süresi dolmadan yenilenir. Kod ve anahtarlar günlüğe, hata iletisine ve dışa aktarmaya girmez. HA'ya giden istekler her zamanki korumalı yoldan (yetki kesici, tek kapı) geçer.
- **Klasörle eşitleme (Ayarlar > Klasörle eşitleme, `klasorEsitleme`):** Seçtiğin bir klasörde (örn. OneDrive, Syncthing) tek dosya `ev-paneli-esitleme.json` tutulur. Yalnız açık bir beyaz listedeki bölümler eşitlenir: favoriler (favoriler, panolar, sayfalar), kısayollar (kısayol, palet ve geri al kısayolu, tepsi sol tık), görünüm, bilgi kartları ve bildirimler. HA adresleri, anahtarlar, üstbilgi değerleri, sertifika kayıtları, parola, dış tetik ayarları, kamera izinleri, pencere/ekran konumları ve makineye özgü seçenekler eşitlenmez. Her bölüm kendi zaman damgasıyla birleşir (damgası büyük olan kazanır; 24 saatten ileri damgalı bölüm geçersizdir); ilk eşitlemede klasördeki sürümün yerelin yerine geçeceği için onay istenir. Klasörden gelen HER bölüm içe aktarmayla AYNI süzgeçten (şema doğrulaması, Kapı Kuralı, kısayol denetimi) geçer. İsteğe bağlı parola dosyayı şifreler (parola `esitleme-parola.dat` içinde `safeStorage` ile durur); parola ayarlıyken düz dosya güvenilmez sayılır.

---

## 🛠️ Kurulum ve Geliştirme

### 1. Gereksinimler
- **Windows 10 / Windows 11 (64-bit)** (Windows 11 22H2 ve üstü: Akrilik/Mica pencere malzemesi için)
- **Node.js**: Node LTS v24.x önerilir ([nodejs.org](https://nodejs.org/)).

### 2. Proje Kurulumu
Komut satırında proje dizinindeyken bağımlılıkları yükleyin:
```powershell
npm install
```

### 3. Geliştirici Modunda Çalıştırma
Uygulamayı hemen test etmek ve çalıştırmak için:
```powershell
npm start
```
Bu kopya kurulu sürümden ayrıdır (başlıkta `[geliştirme]`, ayrı kullanıcı klasörü `%APPDATA%\Ev Paneli (gelistirme)\`).

### 4. Kurulum Dosyası (.exe) Üretme
Kullanıcı başına kurulan, yönetici (admin) izni gerektirmeyen, Başlat menüsü kısayolu oluşturan tek tık NSIS kurulum paketi üretmek için:
```powershell
npm run dist
```
İşlem tamamlandığında `dist/` klasörü altında **`Ev-Paneli-Kurulum-1.5.0.exe`** dosyası hazır olacaktır (dosya adındaki sürüm `package.json` içindeki `version` değerinden gelir).

Kurulum gerektirmeyen tek dosyalık bir sürüm de üretilebilir:
```powershell
npm run dist:tasinabilir
```
Çıktı `dist/` altında **`Ev-Paneli-Tasinabilir-1.5.0.exe`** olur. Ayarlar, anahtar ve HA oturumu kurulu sürümle aynı klasörde (`%APPDATA%\Ev Paneli`) tutulur; kurulu sürüm çalışırken taşınabilir exe ikinci bir kopya açmaz, çalışan pencereyi öne getirir. Taşınabilir sürümde "Windows açılınca başlat" yoktur. **Eski sürüm uyarısı:** Aynı klasörü 1.3.0 ya da daha eski bir kopya da (kurulu ya da taşınabilir) açarsa, o sürüm ayar dosyasını kendi biçimine geri yazar ve 1.4.0'da eklediğiniz favoriler, karo alanları ve arayüz dili silinir. Bir sonraki 1.4.0 açılışında bu kayıp, saklanan eski sürüm yedeğinden (`ayarlar.v6-yedek*.json`, en çok 5 adet) otomatik geri alınır ve bir bildirimle söylenir; yine de iki sürümü aynı anda kullanmamanız önerilir. exe her açılışta kendini geçici bir klasöre açtığı için komut satırı çağrıları (`--eylem`, `--goster`, `--durum`) kurulu sürümden belirgin biçimde yavaştır; sık kullanılan kısayollar ve Stream Deck için kurulu sürümü tercih edin.

### 5. Simgeleri Yeniden Üretme
Tepsi simgeleri (`assets/ikon.png`, `ikon.ico` ve bağlantı yokken kullanılan soluk `ikon-soluk.png`, `ikon-soluk.ico`) harici bağımlılık olmadan Node ile üretilir; pencere açmaz, yalnız dosya yazar:
```powershell
npm run ikon
```

### 6. Güncelleme (1.0.0'dan 1.1.0'a)
Kurulu 1.0.0'ın üzerine yeni kurulum dosyasını (`Ev-Paneli-Kurulum-1.1.0.exe`) çalıştırmak yeterlidir; önce kaldırmanız gerekmez. Kurulum aynı kimlikle (`appId: io.github.emre-pn.evpaneli`, kullanıcı başına, yönetici izni istemez) `%LOCALAPPDATA%\Programs\ev-paneli\` altına yapılır ve bitince uygulama kendiliğinden açılır. Kurulum dosyasının gerçek Windows'ta 1.0.0'ın üzerine çalıştırılması **denenmedi**; sorun çıkarsa haber verin.

### 7. Güncelleme (1.1.0'dan 1.1.1'e)
Kurulu 1.1.0'ın üzerine `Ev-Paneli-Kurulum-1.1.1.exe` dosyasını çalıştırmak yeterlidir (ayarlarınıza ve anahtarınıza dokunulmaz). **Önemli:** 1.1.0'da erişim anahtarı Home Assistant'ta silinmişse ya da iptal edilmişse, uygulama her açılışta o geçersiz anahtarla birçok istek atıp Home Assistant'ın IP engelleme (`ip_ban`) özelliğini tetikleyebiliyordu (önce bu bilgisayarın, sonra dış adrese geçince evin internet IP'sinin engellenmesi). 1.1.1 bunu önler: kurulunca uygulama eski anahtarla Home Assistant'a **yalnız 1 doğrulama isteği** dener; Home Assistant anahtarı reddederse (401) uygulama **durur** (o anahtarla hiçbir adrese istek göndermez; yeniden başlatsanız da) ve *"Erişim anahtarı Home Assistant tarafından reddedildi. Güvenlik için istekler durduruldu; Ayarlar'dan yeni bir anahtar kaydedin."* bildirimini bir kez verir. Bu durumda Home Assistant profilinizde (Güvenlik → Uzun ömürlü erişim anahtarları) yeni bir anahtar oluşturup **Ayarlar'dan yeni anahtarı kaydedin**; kayıt da yalnız 1 istek gönderir. Aynı (reddedilmiş) anahtarı yeniden kaydetmek engeli kaldırmaz. Home Assistant doğrulama isteğine hiç yanıt vermezse (zaman aşımı, bağlantı kopması) Home Assistant isteği yine de saymış olabileceğinden uygulama durur ve Ayarlar'da **Yeniden Dene** bekler. Bu bilgisayardan art arda 2 ya da daha fazla hatalı anahtar denendiyse yeni anahtarı kaydetmek için Ayarlar'da açık bir **ikinci onay** (*"Anladım, yine de doğrula"*) gerekir: Home Assistant 5 hatalı denemede IP'yi engeller (onay yalnız tek deneme içindir). Ayrıntı: [Sürüm Geçmişi](#sürüm-geçmişi).

Güncellemeden önce:

- **Uygulamaları kapatın:** kurulu uygulamayı ve açıksa geliştirme kopyasını (`npm start`) tepsi simgesine sağ tıklayıp **Çıkış** ile kapatın. Kurulum açık uygulamayı zorla kapatır; o sırada oturum (giriş bilgisi) diske yazılmamış olabilir. Geliştirme kopyası açık kalırsa iki kopya aynı genel kısayolları almaya çalışır ve kısayollar çakışır.
- **İsteğe bağlı yedek:** iki uygulama da kapalıyken `%APPDATA%\Ev Paneli` klasörünün tamamını (`Partitions` dahil) başka bir yere kopyalayabilirsiniz.
- **Geliştirme kopyasındakiler taşınmaz:** `npm start` ile açılan kopyada yaptığınız ayar, favori ve girişler kurulu sürüme geçmez; o kopya ayrı klasör (`%APPDATA%\Ev Paneli (gelistirme)\`) kullanır. Kurulu sürüm kendi klasöründeki verilerle açılır.

Korunanlar ve ilk açılışta olanlar (kod okunarak doğrulandı, gerçek Windows'ta **denenmedi**):

- **Veri klasörü aynıdır** (`%APPDATA%\Ev Paneli\`): ayarlar, favoriler, panolar, Home Assistant oturumu (Electron'un `persist:ha` bölümü; diskte `Partitions\ha\` klasörü, `persist:` öneki klasör adına girmez) ve şifreli anahtar yerinde kalır; kurulum ve kaldırıcı bu klasörü silmez (`deleteAppDataOnUninstall: false`).
- **Ayar şeması kendiliğinden yükseltilir** (1.0.0'ın dosyasında şema sürümü yoktur, 1 sayılır; şimdiki sürüm 6): ilk açılışta mevcut değerleriniz ve favorileriniz korunarak okunur, yeni alanlar varsayılanla eklenir ve dosya yeni biçimiyle diske yazılır; hiçbir favori sessizce silinmez. **Yeni biçim yazılmadan önce özgün dosya aynı klasöre `ayarlar.v1-yedek.json` olarak otomatik kopyalanır** (aynı adlı yedek zaten varsa üzerine yazılmaz; kopyalanamazsa göç yine sürer ve `logs\ev-paneli.log`a bir satır yazılır). Görünür sonuçları:
  - PC kapat, PowerShell, "İyi geceler" gibi geri alınması zor favoriler artık çalıştırılmadan önce onay sorar; böyle favoriler varsa hangileri olduğu ilk açılışta bildirimle söylenir.
  - Pencere hızlı boyutta (560 × 780) açılır; 1.0.0'da kayıtlı bir pencere boyutu varsa "geniş" modun boyutu olur (`Ctrl+Shift+G` ile geçilir). Pencere konumu artık saklanmaz (imleç monitöründe açılır).
  - Home Assistant'a ulaşılabiliyorsa ilk açılışta **bir kez** hazır ilk liste, favorilerinizde eksik olan karoları sona ekler (mevcut favorilere ve sıralarına dokunmaz, kapı kuralından geçmeyenler eklenmez). İstemediğiniz karoyu Ayarlar'dan çıkarın; Ayarlar'daki "Hazır Listeyi Yeniden Uygula" düğmesine basmadıkça geri gelmez.
- **Anahtar dosyası yeni biçime taşınır:** 1.0.0 anahtarı eşzamanlı `safeStorage` ile yazmıştı; 1.1.0 anahtarı ilk okuduğunda (ilk açılışta) dosya eski biçimdeyse doğrulayarak yeni biçimle yeniden yazar. Önce özgün dosya `anahtar.dat.eski` olarak yedeklenir (yedek alınamazsa taşıma yapılmaz); yeni biçim sonraki bir açılışta sorunsuz okununca yedek kendiliğinden silinir. Taşıma başarısız olursa özgün dosya kalır ve çalışmaya devam eder. Favoriler çalışmıyorsa Ayarlar'dan anahtarı bir kez yeniden kaydedin (ayrıntı: [Elle Deneme — Dalga 2](#elle-deneme--dalga-2-güvenlik-geri-bildirim-onay-günlük)).
- **Windows ile otomatik başlatma:** bu ilk güncellemede (1.0.0 → 1.1.0) güncellemeyi **1.0.0'ın kaldırıcısı** yapar ve o kaldırıcı kayıt defterindeki başlatma kaydını ve Windows'ta (Görev Yöneticisi > Başlangıç) verdiğiniz "kapalı" işaretini siler. 1.1.0 kurulum bitince kendiliğinden açılır ve ilk açılışta kaydı Ayarlar'daki seçime göre yeniden yazar; ayar açıksa kayıt geri gelir. Windows'ta kapatmış olsanız bile, o işaret silindiği için bu ilk güncellemede kayıt bir kez yeniden açılabilir; istemiyorsanız Ayarlar'daki "Windows açılınca otomatik ve gizli (tepside) başlasın" seçeneğini kapatın. 1.1.0'ın kaldırıcısı (`build/installer.nsh`) kaydı yalnız **gerçek kaldırmada** siler; bu yüzden 1.1.0'dan **sonraki** güncellemelerde kayıt ve "kapalı" işareti olduğu gibi korunur. Gerçekten böyle olduğunu Ayarlar'dan ya da Windows Ayarlar > Uygulamalar > Başlangıç'tan kontrol edin (**denenmedi**).

---

## 🧪 Otomatik Testler (`npm test`) ve Statik Denetim

```powershell
npm test            # node --test: test/ altındaki tüm testler
npm run kontrol     # node araclar/kontrol.js: her .js için node --check, satır içi betik sözdizimi, CRLF, yasaklı kalıplar
```

- **Hiçbir pencere açılmaz, Electron çalıştırılmaz.** `src/main.js` testlerde sahte bir `electron` modülüyle (bellek içi sahte pencere, tepsi, bildirim, WebSocket ve Home Assistant) yüklenir; ayarlar geçici bir klasöre yazılır, gerçek `%APPDATA%` ve gerçek erişim anahtarı kullanılmaz. Renderer betikleri (`ayarlar.js`, `yuzey-sayfa.js`, `kose-sayfa.js`, `offline.js`) sahte DOM ile çalıştırılır.
- Saf mantık `src/lib/` altındadır (CommonJS, Electron'a bağlı değil) ve `test/` altında `node:test` ile sınanır. Yeni bağımlılık eklenmez.
- Testler **görsel sonucu** (Akrilik/Mica, başlık çubuğu rengi, tepsi taşma alanı, tuş/odak davranışı) sınayamaz; bunlar aşağıdaki elle deneme listelerindedir.
- Sürüm numarası `package.json` içindedir; kurulum dosyasının adı ondan türer ve `test/yapi.test.js` ikisinin tutarlı olduğunu sınar. Değişiklikler [Sürüm Geçmişi](#sürüm-geçmişi) bölümündedir.

---

## 🔑 Home Assistant'ta Erişim Anahtarı Oluşturma

Tepsi menüsünden pencereyi açmadan favori cihazları kontrol edebilmek için Home Assistant REST API erişim anahtarı gereklidir:

1. Tarayıcınızda Home Assistant arayüzüne giriş yapın.
2. Sol alt köşedeki **Profilinize** (kullanıcı adınız/resminiz) tıklayın.
3. Üst menüden veya sayfanın altındaki **Güvenlik** sekmesine gidin.
4. En alta inip **"Uzun ömürlü erişim anahtarları" (Long-Lived Access Tokens)** bölümünü bulun.
5. **"Anahtar Oluştur"** düğmesine tıklayın.
6. Bir ad verin (örn. `Ev Paneli Masaüstü`) ve **Tamam**'a basın.
7. Ekranda görünen uzun karakter dizisini kopyalayın *(Bu anahtar yalnızca bir kez gösterilir)*.
8. Ev Paneli'nin **Ayarlar** penceresini açın (Tepsi menüsünden `Ayarlar…` veya çevrimdışı sayfasındaki `Ayarlar` düğmesi).
9. **"Home Assistant Erişim Anahtarı"** kutusuna yapıştırıp **"Anahtarı Doğrula ve Kaydet"** butonuna basın.
10. Anahtarınız Windows DPAPI (`safeStorage`) ile şifrelenerek güvenle kaydedilecek ve cihaz listeniz yüklenecektir.

---

## 📁 Ayar Dosyası ve Konumlar

Uygulamanın ayarları ve şifrelenmiş verileri Windows kullanıcı profilinizde saklanır (geliştirme sürümünde klasör adı `Ev Paneli (gelistirme)`):

- **Ayar Dosyası:**  
  `%APPDATA%\Ev Paneli\ayarlar.json`  
  *(Örn: `C:\Users\<Kullanici>\AppData\Roaming\Ev Paneli\ayarlar.json`)*  
  Adresler, kısayol tuşları, pencere boyutları, favori varlık kimlikleri, panolar ve Görünüm ayarları (`temaZorla`, `vurguRengi`, `yeniPencereMalzemesi`) bu dosyada JSON formatında tutulur. Şema sürümü yükseltilirken (şu an 6) kullanıcının mevcut değerleri ve favorileri korunur, yeni alanlar varsayılanla eklenir; hiçbir favori sessizce silinmez. Dosya bozulursa silinmez: `ayarlar.bozuk-<zaman>.json` olarak aynı klasörde saklanır, varsayılan ayarlarla başlanır ve açılışta dosya adıyla bildirilir. Dosya diske yazılamazsa (disk dolu, kilitli dosya) Ayarlar "kaydedildi" demez, hata gösterir.
- **Göç Öncesi Ayar Yedeği:**  
  `%APPDATA%\Ev Paneli\ayarlar.v<eski-sürüm>-yedek.json`  
  *(Eski şemadaki ayar dosyası yeni biçimiyle yazılmadan önce özgün haliyle kopyalanır; 1.0.0'dan gelen dosya şema 1 sayıldığından `ayarlar.v1-yedek.json` olur. Aynı adlı yedek varsa üzerine yazılmaz; kopyalanamazsa göç yine sürer ve günlüğe bir satır düşer. Uygulama bu dosyayı kendisi silmez; gerek kalmayınca elle silebilirsiniz.)*
- **Son Kullanılanlar:**
  `%APPDATA%\Ev Paneli\son-kullanilanlar.json`
  *(Panel ve paletten çalıştırılan zararsız eylemlerin yalnız varlık kimliği ve zamanı; en çok 50 kayıt. Sır içermez; silerseniz "Son kullanılanlar" boşalır.)*
- **Yetki Kesici Kaydı:**
  `%APPDATA%\Ev Paneli\yetki-kesici.json` (aynı içerik yanında `yetki-kesici.yedek.json` dosyasına ve `%LOCALAPPDATA%\Ev Paneli\yetki-kesici.yedek.json` dosyasına da yazılır)
  *(Home Assistant'ın reddettiği erişim anahtarlarının yalnız 16 haneli parmak izi (SHA-256'nın ilk 16 onaltılık hanesi), zamanı ve neden kodu; anahtarın kendisi hiçbir yerde saklanmaz ya da günlüğe yazılmaz. Bu parmak izine sahip anahtarla hiçbir adrese istek gönderilmez; farklı bir anahtar kaydedince ya da "Anahtarı sil" deyince temizlenir/aşılır. Silmeyin: silerseniz reddedilmiş anahtar bir kez daha denenir.)*
- **Şifreli Anahtar Dosyası:**  
  `%APPDATA%\Ev Paneli\anahtar.dat`  
  *(Yalnızca geçerli Windows kullanıcısı tarafından DPAPI ile çözülebilen ikili şifreli veri. Eski biçimli dosya yeni biçime çevrilmeden önce `anahtar.dat.eski` olarak yedeklenir; yeni biçim sonraki bir açılışta sorunsuz okununca yedek kendiliğinden silinir, yazılamayan/çözülemeyen yeni dosya için anahtar yedekten okunur. Anahtarı silmek ya da yenisini kaydetmek yedeği de siler.)*
- **1.4.0 ile gelen dosyalar (hepsi `%APPDATA%\Ev Paneli\` altında):** `etkinlik-gecmisi.json` (etkinlik geçmişi, sır yok), `guncelleme.json` ve `surum-denetimi.json` (denetim zamanı ve bilgi, sır yok), `ev-paneli-esitleme.json` (yalnız seçtiğin eşitleme klasöründe) ve `safeStorage` ile şifreli `oauth-oturum.dat` (yenileme anahtarı), `ozel-ustbilgiler.dat` (üstbilgi değerleri), `yerel-api-jetonu.dat` (yerel API jetonu), `mobil-kayit.dat` (mobil webhook kimliği), `esitleme-parola.dat` (eşitleme parolası). Şifreli dosyalar yalnız bu Windows kullanıcısının oturumunda çözülür; başka bir bilgisayara kopyalanınca işe yaramaz.
- **Günlük Dosyası:**  
  `%APPDATA%\Ev Paneli\logs\ev-paneli.log`  
  *(Bağlantı, çökme ve hata olayları; 256 KB dolunca `ev-paneli.1.log`'a döner. Erişim anahtarı, Bearer, webhook kimliği ve URL içi parola günlüğe yazılmaz. Geliştirme sürümünde klasör `%APPDATA%\Ev Paneli (gelistirme)\logs\`.)*
- **Kalıcı Oturum Bölümü (Session Partition):**  
  `%APPDATA%\Ev Paneli\Partitions\ha\`  
  *(Electron'un `persist:ha` bölümü; `persist:` öneki klasör adına girmez. Home Assistant arayüzünün çerezleri, LocalStorage ve oturum verileri; adres/köken başına ayrı tutulur. Yedek alırken, uygulama kapalıyken klasörün TAMAMINI kopyalayın; içinden tek tek dosya almak oturumu tutarlı biçimde geri getirmeyebilir.)*

---

## ⚙️ Otomatik Başlatmayı Açma / Kapatma

Uygulama, Windows oturumunuz açıldığında arka planda (yalnızca sistem tepsisinde gizli) başlayacak şekilde yapılandırılabilir:

- **Tepsi Menüsünden:** Tepsi simgesine sağ tıklayın ve **"Windows açılınca başlat"** onay kutusunu işaretleyin veya kaldırın.
- **Ayarlar Penceresinden:** Ayarlar penceresindeki **"Windows açılınca otomatik ve gizli (tepside) başlasın"** seçeneğini kullanabilirsiniz.
*(Not: Bu özellik paketlenmiş/kurulmuş sürümde Windows `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` anahtarını yönetir; geliştirme sürümü hiçbir şey yazmaz).*

---

## 🗑️ Uygulamayı Kaldırma (Uninstall)

1. Windows **Ayarlar > Uygulamalar > Yüklü Uygulamalar** bölümüne gidin.
2. **Ev Paneli** uygulamasını bulun ve **Kaldır** seçeneğini seçin.
3. Kaldırıcı, Windows otomatik başlatma kayıtlarını ve Başlat menüsü kısayolunu temizler. Otomatik başlatma kaydı yalnız gerçek kaldırmada silinir; güncellemede korunur (1.1.0'dan sonraki güncellemelerde geçerlidir; bkz. [Güncelleme](#6-güncelleme-100dan-110a)).
4. İsteğe bağlı: Oturum verilerini ve ayarları da tamamen sıfırlamak isterseniz `%APPDATA%\Ev Paneli` klasörünü silebilirsiniz. Reddedilmiş anahtar kaydının ikinci kopyası bu klasörün dışındadır; tam sıfırlama için `%LOCALAPPDATA%\Ev Paneli\yetki-kesici.yedek.json` dosyasını da silin (yoksa reddedilmiş anahtar kaydı yerinde kalır).

---

## 🙋 Önerilen elle ayarlar ve denemeler

Aşağıdakiler kodla çözülmez ya da bu ortamda denenemez; sizin yapmanız/denemeniz gerekir. Hiçbiri kapı/kilit çalıştırmaz.

- [ ] **Home Assistant kenar çubuğunu gizleyin (pencere-06, "sade pencere"):** Ev Paneli penceresinde Home Assistant profil sayfanızı açın (sol alttaki kullanıcı adınız) ve **tarayıcı/cihaz ayarlarındaki "Kenar çubuğunu her zaman gizle"** seçeneğini açın (HA sürümüne göre adı ve yeri değişebilir; **denenmedi**). Bu ayar cihaza/tarayıcıya özeldir ve **adres başınadır**: Ev Paneli kendi tarayıcı verisini kullandığından ayarı Ev Paneli'nin içinden yapın; ev içi adres ile dış adres ayrı kökenlerdir, ikisinde de ayrı ayrı yapmanız gerekebilir. HA 870 pikselin altında kenar çubuğunu zaten çekmeceye alır; pencereyi dar tutmak da yeter. HA'da başlığı da gizleyen "kiosk-mode" eklentisi kurulu değil; kurmak ayrı bir iştir. Başlık çubuğunu tamamen kaldırıp HA sayfasına sürükleme alanı eklemek kırılgandır ve yapılmadı.
- [ ] **Ev içi adresi HTTPS yapın:** Ev içi adres `http://192.168.1.10:8123` iken erişim anahtarı (ve canlı bağlantı) ev ağınızda şifresiz gider; uygulama bunu her açılışta günlüğe yazar ve adres başına bir kez bildirir. Evde de çalışan geçerli sertifikalı bir HTTPS adresiniz varsa (ör. ters vekil, DuckDNS, Nabu Casa ev içi adresi) Ayarlar > Bağlantı Adresleri > "Ev içi adres" kutusuna doğrudan `https://...` yazın (sertifika normal doğrulanır; yönlendirmeler izlenmez, bu yüzden `http`→`https` yönlendiren adres seçilmez). Kendi imzalı sertifikada canlı bağlantı (WebSocket) Node'un sertifika deposundan geçtiği için kurulamayabilir; günlükte görünür ve REST yedeği sürer (**denenmedi**).
- [ ] **Bayatlama denemesi (hiz-13):** Paneli açıp **10-15 dk gizleyin**, kısayolla açın ve ışık durumlarının kaç saniyede güncellendiğine bakın. Pencere gizliyken HA sayfası yüklü bekler (anında açılış buradan gelir); HA ön yüzü bağlantısını bırakıp ilk gösterimde durumlar bir an eski görünebilir (**denenmedi**). Yavaşsa sırayla: HA profilinde arka plan bağlantılarını askıya alma ayarını kapatın (ayar adı doğrulanmadı); olmazsa haber verin (gizliyken arka plan kısıtını kapatmanın CPU/güç maliyeti ölçülmedi, denemeden açılmaz). Ayrıca bir kez Görev Yöneticisi'nde "Ev Paneli" süreçlerinin gizliyken kaynak kullanımına bakın.
- [ ] **HA'nın kendi hızlı arama tuşu (hiz-14):** Kısayolla pencereyi açıp **`e`** tuşuna basın, "ışık" yazın: HA'nın varlık arama kutusu açılıp ışıkları listeliyorsa kodsuz bir palet alternatifiniz vardır (`c` = komut, `d` = cihaz). Bu tuşların yönetici kullanıcı gerektirip gerektirmediği ve başka bir hızlı arama kısayolunun olup olmadığı doğrulanmadı; uygulama bu tuşları yakalamaz (yalnız `Ctrl+R`/`F5`/`F11` vb.). Çıkmıyorsa uygulamanın kendi paleti (`Ctrl+Alt+P`) zaten bunun içindir.
- [ ] **Oyun açıkken kısayol (pencere-07):** Özel tam ekran bir oyun açıkken `Ctrl+Alt+H` / `Ctrl+Alt+P` / eylem kısayoluna basın. Pencere normal bir pencere, "her zaman üstte" değil; Windows'un ön plan kuralı yüzünden özel tam ekran oyunun üstünde görünmeyebilir ya da odak almayabilir (**denenmedi**, belgelerde de anlatılmıyor). Görünmüyorsa oyunu kenarlıksız pencere moduna alın ya da doğrudan eylem kısayoluna (köşe bildirimi/bip geri bildirimiyle) yaslanın. Köşe bildiriminin (`focusable:false`) tam ekran oyun üstünde görünüp görünmediği de denenmedi.
- [ ] **Dalga 4 görünüm denemeleri:** aşağıdaki ["Elle Deneme — Dalga 4"](#elle-deneme--dalga-4-windows-11-görünümü-tema-tepsi-ipucu) listesi.

---

## 🧪 Elle Deneme ve Test Kontrol Listesi

Uygulamayı test ederken aşağıdaki senaryoları sırayla deneyebilirsiniz:

- [ ] **1. Otomatik Başlama ve Gizli Başlatma:**  
  Ayarlardan "Windows açılınca otomatik başlat"ı açın. Bilgisayarı veya oturumu kapatıp açın; uygulama doğrudan pencere açmadan sağ alttaki sistem tepsisinde belirmelidir.
- [ ] **2. Genel Kısayol Tuşu (`Ctrl + Alt + H`):**  
  Herhangi bir başka programdayken (tarayıcı, Not Defteri vb.) `Ctrl + Alt + H` tuşlarına basın. Ev Paneli penceresi anında öne gelmelidir. Pencere görünür ve odaktayken tekrar bastığınızda gizlenmelidir; pencere görünür ama başka bir pencerenin arkasındayken basarsanız gizlenmemeli, öne gelmelidir.
- [ ] **3. X Düğmesi ve Tepsiye Gizleme:**  
  Pencerenin sağ üstündeki kapatma (**X**) düğmesine basın. Pencere kapanır gibi olur ancak sistem tepsisinde çalışmaya devam eder. İlk gizlemede Windows bilgilendirme bildirimi çıkar (simgeyi `^` okundan görünür alana sürükleme ve "Çıkış" ipucu); sonraki gizlemelerde çıkmaz.
- [ ] **4. Tek Kopya Koruması (Single Instance):**  
  Uygulama çalışırken Başlat menüsünden veya komut satırından `Ev Paneli`'ni ikinci kez başlatmayı deneyin. Yeni bir süreç açılmaz; tepsideki mevcut pencere öne gelir ve odaklanır.
- [ ] **5. Ağ Seçimi (İnternet Yokken Ev İçi Adresle Açılma):**  
  İnternet bağlantınızı kesin (örneğin modem WAN kablosunu çıkarın veya dış DNS'i engelleyin ama yerel Wi-Fi/Ethernet bağlı kalsın). Uygulama 3 saniye içinde yerel IP'yi (`192.168.1.10:8123`) bulup pencere başlığına `(Ev ağı)` yazarak açılmalıdır.
- [ ] **6. Dış Adresle Açılma:**  
  Ev dışındayken (mobil veri veya farklı bir Wi-Fi) uygulama yerel adrese 3 saniyede ulaşamayınca otomatik olarak `https://ha.example.com` adresine bağlanmalı ve pencere başlığında `(İnternet üzerinden)` yazmalıdır.
- [ ] **7. Sunucu Kapalıyken Hata Sayfası:**  
  Adresleri ayarlardan geçersiz bir IP yapın veya Home Assistant'ı durdurun. Türkçe *"Ev sunucusuna bağlanılamadı"* sayfası gelmeli; geri sayım artan bekleme ile çalışmalı (2, 4, 8, 15, sonra 30 sn; sayfa titremeden yerinde güncellenir) ve "Tekrar Dene" butonu ile manuel yeniden deneme yapılabilmelidir.
- [ ] **8. Favorilerden Cihaz Açma / Kapatma:**  
  Tepsi simgesine sağ tıklayın, menünün üstündeki bir lambaya tıklayın. Lambanın durumu değişmeli ve ekranın sağ altında *"Tavan lambası açıldı / kapatıldı"* köşe bildirimi görünmelidir (Windows bildirimi yalnız hatada çıkar).
- [ ] **9. Kapı Varlığının Listede Görünmemesi (Kapı Kuralı):**  
  Ayarlar penceresinde "Cihazları Listele" butonuna basın. Home Assistant'ta `lock.*`, `alarm_control_panel.*` veya adında/kimliğinde *"kapi", "kapı", "door", "kilit", "lock", "alarm", "garaj", "bariyer", "gate"* geçen hiçbir varlığın listede yer almadığını teyit edin.
- [ ] **10. Yeniden Açınca Oturumun Kalması (adres başına):**  
  Home Assistant'a bağlı olduğunuz adreste (ev içi **ya da** dış) kullanıcı adı ve şifrenizle giriş yapıp "Oturumu açık tut / Beni hatırla"yı işaretleyin. Uygulamadan tepsi menüsündeki "Çıkış" ile tamamen çıkıp tekrar başlatın; **aynı adrese** bağlanıyorsa giriş ekranı sormadan doğrudan panonuz açılmalıdır (`persist:ha` oturumu korunur). Başka bir adrese (ör. ev dışında dış adres) bağlanırsa o adres ayrı kökendir; orada **bir kez ayrıca** giriş gerekir ve sonra o da kalır.
- [ ] **11. Kısayol Tuşları:**  
  Home Assistant arayüzündeyken `Ctrl + R` ile sayfanın yenilendiğini, `F11` ile tam ekrana geçip çıktığını doğrulayın. Tam ekrandayken uygulamayı tepsiye gizleyip kapatıp açın: tam ekran durumu hatırlanmaz, normal pencereyle açılmalıdır.

---

## Elle Deneme — Dalga 1 (pencere davranışı, ağ, kısayol)

Kod tarafı `npm test` ve `npm run kontrol` ile statik olarak denetlenir (pencere açmaz). Aşağıdakiler gerçek pencerede elle denenir:

- [ ] **Odak kaybında gizle:** Paneli açıp başka bir pencereye tıklayın; yaklaşık 0,2 sn sonra gizlenmeli. Ayarlar penceresi ya da HA alt penceresi (ör. kamera) odaktayken gizlenmemeli. Ayarlar > Pencere Davranışı'ndan kapatılabilir.
- [ ] **Ctrl+W:** Panel gizlenir (uygulama kapanmaz).
- [ ] **Tepsi simgesi:** Panel görünürken tıklamak gizler, gizliyken tıklamak açar; panel arkada görünürse öne getirir. "Başka bir yere tıklayınca gizlensin" kapalıyken de aynı şekilde çalışmalı.
- [ ] **İmleç monitörü:** İkinci monitördeyken `Ctrl+Alt+H` — panel imlecin olduğu monitörde, ortada açılmalı.
- [ ] **Hızlı / Geniş boyut:** Tepsi menüsü > "Geniş pencere" ya da `Ctrl+Shift+G`; her modun boyutu ayrı hatırlanır, geniş modun büyütülmüş durumu da. Tam ekran durumu hatırlanmaz.
- [ ] **Uzun gizli kalma:** Ayarlar'daki süreden (varsayılan 5 dk) uzun gizli kaldıktan sonra açınca ana panoya dönmeli; kısa sürede kaldığı yerden devam etmeli.
- [ ] **Pencere içi kısayollar:** `Ctrl +` / `Ctrl -` / `Ctrl 0` yakınlaştırma (kalıcı), `Alt+←` / `Alt+→` ve fare yan tuşları geri/ileri, `F5` / `Ctrl+R` yenile, `Ctrl+Shift+R` önbelleksiz yenile, `F11` tam ekran, `Ctrl+W` gizler.
- [ ] **Oturum açılışı:** Windows Ayarlar > Uygulamalar > Başlangıç'tan kapatıp Ayarlar'ı açın; durum "Windows’ta kapatılmış" görünmeli, "Yeniden etkinleştir" düğmesi çalışmalı. Uygulama bu kararı kendiliğinden ezmez (tek istisna: 1.0.0'dan 1.1.0'a ilk güncelleme; bkz. [Güncelleme](#6-güncelleme-100dan-110a)).
- [ ] **Geçersiz kısayol:** Ayarlar'a `F9` yazıp Kaydet — uyarı çıkmalı, adres ayarı yine de kaydedilmeli, eski kısayol çalışmaya devam etmeli.
- [ ] **Cloudflare / 5xx:** HA kapalıyken ya da dış adres 502/403 dönerken pano "bağlandı" sayılmamalı, hata sayfasında nedeni yazmalı.
- [ ] **Uyku / kilit:** Bilgisayarı uyutup açınca ya da kilidi açınca bekleme sayacı beklemeden yeniden denenmeli.
- [ ] **Geliştirme / kurulu ayrımı:** `npm start` ile açılan kopya başlığında `[geliştirme]` yazar, kurulu uygulamayla aynı anda çalışabilir ve kurulu uygulamanın ayarlarına dokunmaz (ayrı kullanıcı klasörü `Ev Paneli (gelistirme)`, ayrı tek-kopya kilidi). İki kopya aynı genel kısayolu alamaz: ikincisi "kaydedilemedi" uyarısı verir.

---

## Elle Deneme — Dalga 2 (güvenlik, geri bildirim, onay, günlük)

Kod tarafı `npm test` ve `npm run kontrol` ile statik olarak denetlenir (pencere açmaz). Aşağıdakiler gerçek pencerede/Windows'ta elle denenir; **ilk denemeyi geliştirme sürümünde (`npm start`) yapın**, çünkü yerel sayfaların CSP'si yalnız orada F12 konsolundan görülebilir.

- [ ] **CSP (hata-17):** `npm start` ile açın, Ayarlar penceresinde `F12` > Konsol: kırmızı "Content Security Policy" hatası olmamalı; sayfa normal çalışmalı (düğmeler, liste, onay kutuları). Aynısını bağlantı hatası sayfasında deneyin (HA kapalıyken). Hata çıkarsa betik yüklenmiyor demektir; haber verin.
- [ ] **Uzak sayfaya köprü yok:** HA sayfasındayken `F12` > Konsol'da `window.evPaneli` yazın: `undefined` dönmeli.
- [ ] **Anahtar dosyası eski biçimle okunuyor mu (güncellemeden ÖNCE):** İsterseniz güncellemeden önce `%APPDATA%\Ev Paneli\anahtar.dat` dosyasını başka bir klasöre kopyalayın (uygulama ayrıca göçten önce kendi `anahtar.dat.eski` yedeğini alır). Güncelledikten sonra tepsi menüsündeki favoriler çalışmalı. Çalışmıyorsa (menüde "erişim anahtarı geçersiz" yazarsa) Ayarlar'dan anahtarı bir kez yeniden kaydedin. Uygulamayı kapatıp yeniden açın: favoriler hâlâ çalışıyorsa `anahtar.dat.eski` kendiliğinden silinir.
- [ ] **Anahtarı silme (hata-07):** Ayarlar > "Anahtarı Bu Bilgisayardan Sil": onay metni HA'daki anahtarın iptal EDİLMEDİĞİNİ söylemeli; silince çıkan ileti de aynısını söylemeli. (Anahtarı HA profilinizden ayrıca silin.)
- [ ] **Tepsi onay penceresi (hata-04):** Tepsi > "Onaylı eylemler" altında "PC kapat" gibi bir eylem "— onay ister" etiketiyle görünür. Tıklayınca "Çalıştırılsın mı?" penceresi açılmalı; **"Vazgeç" (Enter'ın varsayılanı)** hiçbir şey yapmamalı; "Çalıştır" yalnız o zaman çalıştırmalı. Işık/priz gibi zararsız favoriler pencere sormadan çalışmalı. (Dikkat: "Çalıştır"a basarsanız bilgisayar gerçekten kapanır; denemeyi "Vazgeç" ile yapın ya da zararsız bir düğmeye "Onay iste" işaretleyin.)
- [ ] **Onay kutusu (Ayarlar):** Favori listesinde seçili her satırda "Onay iste" kutusu var; PC kapat gibi eylemlerde "Onaylı (zorunlu)" olup kapatılamaz. Yeni eklenen düğme/script varsayılan onaylıdır; kutuyu kaldırıp kaydedince onaysız çalışır.
- [ ] **Köşe bildirimi (hiz-04):** Bir ışık favorisine tıklayın: ekranın sağ altında ~1,5 sn küçük bir bildirim görünmeli, **odağı çalmamalı** (yazı yazarken klavye odağı değişmemeli) ve fare tıklaması ona takılmamalı. Hata olunca (ör. internet yokken) 3 sn hata köşe bildirimi ve ayrıca Windows bildirimi çıkmalı; başarıda Windows bildirimi ÇIKMAMALI. Tam ekran oyun/video üstünde görünüp görünmediği denenmedi (soru-4: bu iş kapsam dışı).
- [ ] **Bip (isteğe bağlı):** Ayarlar > Geri Bildirim > "Başarılı olunca kısa bip sesi çal"ı açıp kaydedin; başarılı işlemde bip duyulmalı, hatada duyulmamalı.
- [ ] **Favori kaydı (hata-14):** HA'yı yeniden başlatırken ya da HA'da bir cihazı silmişken Ayarlar > "Cihazları Listele": listede gri "bulunamadı (HA'da şu an yok)" satırı görünmeli ve işaretli kalmalı; "Favorileri Kaydet" onu silmemeli (işaretini siz kaldırırsanız silinir). Adı sonradan "kapı"/"kilit" olan bir favori kırmızı "engelli" satırı olarak görünür ve kaydedince çıkarılır (mesajda sayısı yazar).
- [ ] **Kapı/kilit/garaj:** Cihaz listesinde kapı, kilit, garaj, bariyer ya da "gate/lock" adı geçen hiçbir varlık görünmemeli; script/sahne satırlarında "İçinde kapı/kilit çağıran bir script veya sahneyi favoriye koymayın." notu yazar (script içeriği denetlenmez, bu sizin sorumluluğunuzdur).
- [ ] **Ev içi https (hata-01):** Ayarlar'da ev içi adresi `https://...` yaparsanız kabul edilmeli (sertifika normal doğrulanır). `http://` yazılı ve anahtar kayıtlıysa sarı bir uyarı çıkar; herkese açık bir ada (ör. `http://ha.example.com`) `http://` yazarsanız kaydedilmez, "https:// kullanın" hatası çıkar. Ev içi adres `http://` iken ve anahtar kayıtlıyken açılışta (adres başına bir kez) "anahtar şifresiz gidiyor" Windows bildirimi gelir. Yanlış IP'ye (ör. yönlendirici) bağlanmamalı: yanıt Home Assistant değilse adres seçilmez.
- [ ] **Günlük dosyası (hata-06):** `%APPDATA%\Ev Paneli\logs\ev-paneli.log` (geliştirme: `%APPDATA%\Ev Paneli (gelistirme)\logs\`). Bağlantı ve çökme olayları yazılı olmalı; **anahtar, Bearer, webhook kimliği görünmemeli**. 256 KB dolunca `ev-paneli.1.log`'a döner.
- [ ] **Çökme sınırı (hata-06):** Görev Yöneticisi'nden "Ev Paneli" altındaki sayfa (renderer) sürecini art arda sonlandırın: 1, 2, 4, 8 sn sonra yeniden yüklenir; 10 dk içinde 5. çökmede "Sayfa art arda çöktü; otomatik yeniden deneme durduruldu" sayfası gelir ve kendiliğinden denemez. "Tekrar Dene" ya da `Ctrl+R` yeniden başlatır.
- [ ] **Oturum kapatma iptali (hata-06):** Windows'ta Kapat/Oturumu kapat deyip başka bir uygulamanın kapatmayı engellemesine izin verin (kaydedilmemiş belge sorusu) ve **"İptal"** deyin: Ev Paneli'nin X düğmesi yine tepsiye gizlemeli, tepsi simgesi ve pencere çalışmaya devam etmeli. Gerçekten çıkışta pencere gizlenmeye çalışmadan kapanır.

---

## Elle Deneme — Dalga 3 (hızlı panel, palet, canlı durum, kısayollar)

Kod tarafı `npm test` ve `npm run kontrol` ile statik olarak denetlenir; **hiçbir pencere açılmaz, Electron çalıştırılmaz**. Aşağıdakiler gerçek pencerede/Windows'ta elle denenir. **İlk denemeyi geliştirme sürümünde (`npm start`) yapın**; yerel sayfaların CSP'si yalnız orada F12 konsolundan görülebilir. Hiçbir adım kapı/kilit çalıştırmaz.

- [ ] **Hızlı panel (hiz-02):** Tepsi simgesine sol tıklayın: panel simgenin yanında (görev çubuğuna bitişik, ekran içinde) açılmalı, ana pencere açılmamalı; dışarı tıklayınca kapanmalı, odaktayken simgeye tekrar tıklamak da kapatmalı. *Denenmedi:* Windows 11'de simge "gizli simgeler" taşma menüsündeyse `Tray.getBounds()` konumu doğru vermeyebilir (panel ekranın köşesine düşer); karma DPI'lı çoklu monitörde konum kayabilir (`setBounds` iki kez çağrılır). Böyle bir şey görürseniz haber verin.
- [ ] **Eski tıklama davranışı:** Ayarlar > Hızlı Panel ve Komut Paleti > "Tepsi simgesine sol tık" = "Eskisi gibi Home Assistant penceresini aç" yapıp kaydedin: sol tık yine geniş pencereyi açıp kapatmalı.
- [ ] **Panel içeriği (hiz-07, 09, 12, gorunum-12):** Gruplar sırayla Işık, Sahne, PC, Medya, Diğer; onay isteyen (yıkıcı) eylemler en altta "Onaylı" grubundadır. Işık karosunda %10/20/50/100 düğmeleri (ışığın o anki seviyesine en yakın düğme vurgulu, %20'de yalnız soluk "sık kullanılan" noktası) ve kaydırıcı yalnız Ayarlar'da "Parlaklık ayarı" işaretli ışıklarda olur. Ses −/+ düğmesini basılı tutunca ses saniyede ~4 kez değişmeli, bırakınca durmalı. Üst şeritte "♪ Çalıyor · Kulaklık" PC sensörlerinden (`binary_sensor.pc_medya_caliyor`, `sensor.pc_ses_default_device`) okunur; bu sensörler yoksa şerit gösterilmez.
- [ ] **Basılı tutma (soru-3):** Panelde "PC kapat" gibi bir düğmeyi hemen bırakın: hiçbir şey olmamalı. ~0,8 sn tutun: dolum çubuğu dolar ve eylem çalışır. **Denemeyi bilgisayarı gerçekten kapatmayan bir eylemle yapın** (ör. Ayarlar'da bir düğmeyi "Onay iste" işaretleyin) ya da PC kapat için tutmayı tamamlamayın. Tepsi menüsünde aynı eylem onay penceresi sorar (varsayılan *Vazgeç*).
- [ ] **Palet (hiz-01, detay-19):** `Ctrl+Alt+P`: arama kutusu hemen yazmaya hazır olmalı. "isik" Işık'ı bulmalı; "ışık 40" ışığı %40'a getirmeli (parlaklık ayarı açık ışıkta); Shift+Enter seviye satırını açar; Esc önce onu sonra paleti kapatır; onay isteyen satırda Enter'ı basılı tutmak gerekir. **AltGr yan etkisi:** Türkçe Q klavyede AltGr = Ctrl+Alt olduğundan `Ctrl+Alt+<harf>` kısayolları o harfi AltGr ile yazan tuşlarla çakışabilir (harf yazılmaz); sorun yaşarsanız kısayolu değiştirin ya da boş bırakıp kapatın.
- [ ] **Canlı durum (hiz-03):** Bir lambayı telefondan/HA'dan açıp kapatın: açık panelde ve sağ tık menüsünde 60 sn beklemeden değişmeli. Wi-Fi'yi kapatınca üst şeritte "Yedek mod" görünür, ağ gelince "Canlı"a döner. *Denenmedi:* (1) Electron'un Node'unda global `WebSocket` var mı: yoksa günlükte "Canlı bağlantı kullanılamıyor (WebSocket yok)" yazar ve REST yedeği çalışmaya devam eder. (2) Ev içi adres https ve özel/kendi imzalı sertifikaysa: REST istekleri Chromium ağ yığınından, WebSocket Node'dan geçer; Node sistem sertifika deposunu aynı şekilde görmeyebilir, bağlantı kurulamazsa günlükte görünür ve yedek mod sürer (soru-7: sertifika doğrulaması gevşetilmez).
- [ ] **Eylem kısayolları (hiz-05):** Ayarlar > Favoriler'de satırın altındaki "Kısayol" kutusuna `Control+Alt+L` yazıp favorileri kaydedin: kısayol pencere açmadan eylemi çalıştırır, sonuç köşe bildirimiyle gelir. Yıkıcı (onay isteyen) satırlarda kısayol kutusu yoktur. Aynı kısayolu iki eyleme verirseniz ikincisi reddedilir ve nedeni yazılır; başka uygulamanın aldığı kısayol "kaydedilemedi" olarak raporlanır.
- [ ] **Komut satırı (hiz-05):** Uygulama açıkken `"Ev Paneli.exe" --eylem="Salon lambası"` (kurulu sürümde; geliştirmede `npm start -- --eylem="..."`) pencere açmadan çalışmalı. Belirsiz ad, olmayan ad ve onay isteyen eylem hiçbir şey çalıştırmamalı (köşede hata görünür). Uygulama kapalıyken aynı komut uygulamayı gizli başlatıp eylemi çalıştırır.
- [ ] **Panolar (pencere-02):** Ayarlar'da bir pano ekleyin (ad, yol: `/energy`, isteğe bağlı kısayol) ve kaydedin: tepsi menüsünde "Panolar" altında görünmeli; tıklayınca ya da kısayola basınca Home Assistant penceresi o panoda açılmalı.
- [ ] **Ayarlar (detay-20, hiz-07):** Cihaz listesinde sensör benzeri adaylar varsayılan gizlidir ("Gizlenenleri göster (N)"), seçili olanlar her zaman görünür; bu *güvenlik kuralı değil*, yalnız öneridir. "Hazır Listeyi Yeniden Uygula" HA'da bulunan eksik hazır karoları ekler, mevcutlara ve sildiğiniz karolara dokunmaz (silinen karo kendiliğinden geri gelmez).
- [ ] **Bellek ve süreç:** Hızlı panel penceresi açılıştan ~1,5 sn sonra gizli olarak yüklenir (ilk açılış anında olsun diye); Görev Yöneticisi'nde "Ev Paneli" altında bir ek renderer süreci görürsünüz (tahminen birkaç on MB). Çok fazlaysa haber verin: yalnız ilk açılışta yüklenecek şekilde değiştirilebilir.
- [ ] **Odak / öne gelme:** Panel ve palet odak alan, her zaman üstte bir penceredir; tam ekran bir oyunun üstünde nasıl davrandığı *denenmedi* (soru-4: oyun/tam ekran işi kapsam dışı; bkz. "Oyun açıkken kısayol" denemesi).

### Dalga 3 denetim düzeltmeleri: ek elle denemeler

Aşağıdakiler statik olarak (sahte DOM, sahte zamanlayıcı, sahte WebSocket) test edildi; gerçek yerleşim motoru, Windows tuş tekrarı ve odak kuralları bu ortamda denenemez.

- [ ] **Panel/palet yüksekliği (gorunum-01):** Panelde çok karo varken pencere ekrandan taşmadan kendi içinde kaydırılmalı; bir grup boşalınca (ör. hepsi süzülünce) ve palette arama sonucu azalınca pencere küçülmeli, çoğalınca büyümeli. Işık satırını açıp kapatınca yükseklik değişmeli, altta boşluk ya da kesilmiş satır kalmamalı.
- [ ] **Kısayola basılı tutma (hiz-05):** Eylem kısayolunu (ör. `Control+Alt+L`) 1 sn basılı tutun: eylem YALNIZ BİR kez çalışmalı (tuş tekrarı ikinci çalıştırma yapmamalı). Palet kısayolunu basılı tutunca palet açılıp kapanıp durmamalı. Tuşu bırakıp yeniden basınca normal çalışmalı.
- [ ] **Palette tıklama sonrası klavye:** Palette bir satıra tıklayıp bırakın, sonra Esc'ye basın: palet kapanmalı; yazmaya başlayınca yazı arama kutusuna gitmeli. Onay isteyen (yıkıcı) bir satıra KISA tıklayın: hiçbir şey çalışmamalı (eylem yalnız ~0,8 sn tutunca çalışır). Satır üzerinde tuşu basılı tutarken imleci kaydırıp başka yerde bırakın: eylem çalışmamalı.
- [ ] **Hata geri bildirimi (gorunum-13):** Bir eylem reddedilince (ör. Home Assistant'a ulaşılamıyorken) karo ~3 sn kırmızı çerçeve almalı ve ipucu satırında "“X” çalıştırılamadı." yazmalı; onay isteme ya da çok sık basma durumunda kırmızı gösterilmemeli. Karoya basılı tutarken (`:active`) anında tepki görünmeli. *Yapılmadı:* tıkta durumu beklemeden iyimser renk değiştirme yok; renk canlı durum gelince değişir.
- [ ] **Yedek mod görünümü:** Wi-Fi'yi kapatınca ya da bağlanırken başlıkta "Durumlar eski olabilir" rozeti çıkmalı ve durum metinleri hafif solmalı (karolar solmaz), ağ gelince normale dönmeli.
- [ ] **Medya satırları:** Medya grubunda "Çıkış", "Ses" ve "Oynat" ayrı satırlarda olmalı; sığmayan yerde alt satıra kırılmalı.
- [ ] **"Son" listesi:** Palette en çok 5 öğe görünmeli.
- [ ] **Kaydırıcı klavye (hiz-09):** Parlaklık kaydırıcısında ok tuşunu basılı tutun: değer akıcı değişmeli ama Home Assistant'a saniyede çok istek gitmemeli (ara değerler birleştirilir, SON değer her zaman gönderilir).
- [ ] **Odak yedeği (pencere-odak):** Panel/palet açıldıktan ~0,3 sn sonra hâlâ odakta değilse uygulama kendisi odaklamayı yeniden dener. Başka bir uygulamanın üzerinde ya da tam ekran oyunda panelin odak alıp almadığını elle deneyin (Windows ön plan kilidi bu ortamda denenemez).
- [ ] **Uyanış / ağ değişimi:** Bilgisayarı uyutup başka bir ağda (ör. ev dışı) uyandırın: canlı bağlantı eski adrese takılı kalmamalı, birkaç sn içinde seçilen adrese bağlanmalı ya da "Yedek mod" gösterip yeniden denemeli.
- [ ] **Hazır liste yeniden deneme:** Açılışta Home Assistant ulaşılamazken hazır liste eklenemeyen karolar, sunucu gelince en çok 3 kez (90 sn arayla) otomatik eklenir; sildiğiniz karolar geri gelmez. Uygulama yeniden başlayınca bu otomatik deneme sıfırlanır (kalıcı değildir).
- [ ] **Anahtar kaydı:** Erişim anahtarını Ayarlar'dan kaydedince hazır liste, kayıt tamamlanmadan önce uygulanır ve karolar görünür; ikinci bir elle tetikleme gerekmemeli.
- [ ] **Uygulama kapalıyken komut satırı:** Uygulama açılırken (ayarlar yüklenmeden) ikinci bir `--eylem="..."` komutu gönderilirse eylem sıraya alınır ve ayarlar yüklenince çalışır; geçersiz ad hiçbir şey çalıştırmaz.

---

## Elle Deneme — Dalga 4 (Windows 11 görünümü, tema, tepsi ipucu)

Kod tarafı `npm test` ve `npm run kontrol` ile statik olarak denetlenir (sahte Electron; **hiçbir pencere açılmaz, Electron çalıştırılmaz**). Akrilik/Mica, başlık çubuğu rengi ve tepsi taşma alanı gibi **görsel/sistem sonuçlarının hiçbiri bu ortamda denenmedi**; aşağıdakiler gerçek Windows 11'de elle denenir. İlk denemeyi geliştirme sürümünde (`npm start`) yapın.

- [ ] **Akrilik (gorunum-11):** Ayarlar > Görünüm > "Panel, palet ve bildirim penceresi malzemesi" = Akrilik (varsayılan; Windows 11 22H2+). Tepsi simgesine sol tıklayın: panel yarı saydam ve bulanık görünmeli, arkasındaki masaüstü hafifçe seçilmeli, köşeler yuvarlak olmalı, karolar okunur kalmalı. **Panel opak ya da tamamen siyah görünürse** (`#00000000` arka plan renginin alfa kanalı beklendiği gibi çalışmıyor demektir) **"Düz (opak koyu)" seçin ve haber verin.** Seçim paneli bir sonraki açışınızda tam uygulanır.
- [ ] **Mica:** Aynı ayarı "Mica" yapıp paneli ve `Ctrl+Alt+P` paletini açın: masaüstü duvar kâğıdı tonunda, bulanıklık olmadan yarı saydam görünmeli. Görünmüyorsa "Düz" seçin.
- [ ] **Düz (opak) geri dönüşü:** "Düz" iken panel, palet ve köşe bildirimi opak olmalı: Windows koyu temadayken koyu (`#1b1f27`), açık temadayken açık zemin.
- [ ] **Köşe bildirimi malzemesi:** Bir ışık favorisine tıklayın: sağ alttaki kısa bildirim de seçili malzemeyle görünmeli, odağı çalmamalı (yazı yazarken odak değişmemeli).
- [ ] **Windows 10 / eski Windows 11:** Bu sürümlerde Ayarlar > Görünüm'de "Bu Windows sürümü pencere malzemesini desteklemiyor" uyarısı çıkmalı ve pencereler düz olmalı (elinizde böyle bir makine varsa).
- [ ] **Ana HA penceresi değişmedi:** Ana Home Assistant penceresinin arka planı/rengi eskisi gibi olmalı (malzeme yalnız yeni küçük pencerelerde).
- [ ] **Koyu başlık çubuğu (gorunum-13):** "Her zaman koyu" (varsayılan) iken ana pencerenin ve Ayarlar penceresinin Windows başlık çubuğu koyu çizilmeli (**denenmedi**; Windows'un kendi tema/vurgu ayarına göre değişebilir). Koyulaşmazsa bu bir hata değil, `nativeTheme` yolunun sınırıdır; özel başlık çubuğu bilinçli olarak yapılmadı.
- [ ] **Tema yan etkisi:** HA profilinizde tema "otomatik" ise "Her zaman koyu" iken HA'nın da koyu görünmesi beklenen yan etkidir. İstemezseniz Ayarlar > Görünüm > Koyu tema = "Windows temasını izle".
- [ ] **Vurgu rengi:** Ayarlar > Görünüm > Pencere vurgu rengi = `#e91e63` yazıp kaydedin: ana pencere kenarlığı o renge dönmeli (**denenmedi**; pencere etkin değilken ya da Windows ayarına göre görünmeyebilir). "Sistem Rengi" düğmesi ve boş kayıt Windows rengine döndürür. `kirmizi` gibi geçersiz bir değer kaydedilmemeli, uyarı çıkmalı.
- [ ] **Tepsi ipucu (detay-18):** Tepsi simgesinin üzerine gelince `Ev Paneli — Ev ağı — N ışık açık` yazmalı; bir favori ışığı açıp kapatınca sayı anında (canlı bağlantıda) değişmeli. Wi-Fi'yi kapatınca ipucu "Bağlantı yok" (ya da son bilinen sayıyla "(son bilinen)") demeli. Geliştirme sürümünde `[geliştirme]` yazar. Anahtar, priz ve sahneler sayıya girmez.
- [ ] **Soluk simge:** Bağlantı yokken (Wi-Fi/internet kapalı, adresler yanıtsız) tepsi simgesi soluk/gri görünmeli; bağlantı gelince renkli normal simgeye dönmeli. Açılışta (bağlanırken) kısa süre soluk görünmesi normaldir.
- [ ] **Taşma alanı ve ilk gizleme ipucu:** Uygulamayı ilk kez (ya da `ayarlar.json` içindeki `tepsiIpucuGosterildi` değerini silerek) gizleyin: *"simgeyi görev çubuğundaki ^ okundan görünür alana sürükleyin"* bildirimi çıkmalı. Simgeyi `^` okunun altından görev çubuğuna sürükleyip bırakın; ipucu/soluk simge/panel konumu ancak o zaman görünür/doğru olur. Simge taşma alanındayken sol tıkla panelin nerede açıldığını da gözleyin (**denenmedi**).
- [ ] **`focusable:false`:** Köşe bildirimi odak almadan açılmalı; bu bayrağın Windows'ta gerçekten odak vermediği ve tam ekran uygulamaların üstünde göründüğü **denenmedi**.

## Elle Deneme — 1.1.1 (yetki kesici)

Kod tarafı `npm test` ile (sahte HA, sahte WebSocket, ağ bekçili) denetlenir. Gerçek Home Assistant'a karşı denemek isterseniz **geliştirme sürümünde (`npm start`)** ve kendi evinizde yapın; geçersiz anahtarı Home Assistant'ın `ip_ban` ayarı açıkken denemeyin.

- [ ] **Geçersiz anahtar (kasıtlı):** Home Assistant'ta yalnız bu deneme için bir anahtar oluşturup Ayarlar'a kaydedin, sonra HA profilinizden o anahtarı silin ve uygulamayı yeniden başlatın. HA günlüğünde uygulamadan **tek** başarısız kimlik doğrulama görünmeli; uygulama *"Erişim anahtarı ... reddedildi"* bildirimini bir kez vermeli, tepsi ipucunda *"Erişim anahtarı reddedildi"* yazmalı, tepsi menüsünün üstünde ve hızlı panelin üst şeridinde uyarı görünmeli, Ayarlar'da rozet *"Home Assistant Reddetti — Yeni Anahtar Gerekli"* olmalı.
- [ ] **Yeniden başlatma:** Uygulamayı kapatıp açın: HA günlüğünde uygulamadan **hiç** istek görünmemeli (yalnız anahtarsız `/manifest.json` yoklaması olabilir); bildirim yeniden çıkmamalı.
- [ ] **Yeni anahtar:** HA'da yeni bir anahtar oluşturup Ayarlar'dan kaydedin: tek istekle doğrulanmalı, uyarılar kalkmalı, favoriler ve canlı durum yeniden çalışmalı. Eski (reddedilmiş) anahtarı yeniden yapıştırırsanız HA'ya hiç istek gitmeden "daha önce reddedildi" denmeli.
- [ ] **Kesici açıkken eylemler:** Tepsi favorisine, eylem kısayoluna ya da `--eylem=...`'ye basın: HA'ya istek gitmemeli, köşe ve Windows bildirimi *"Yapılamadı: erişim anahtarı reddedildi; Ayarlar’dan yenisini kaydedin"* demeli.
- [ ] **İkinci onay:** Ayarlar'a art arda iki geçersiz anahtar yapıştırıp kaydedin (HA günlüğünde 2 hatalı giriş görünür), üçüncü bir anahtarı kaydetmeyi deneyin: HA'ya istek gitmeden uyarı ve *"Anladım, yine de doğrula"* kutusu çıkmalı; kutuyu işaretleyince tek doğrulama gitmeli; o deneme 401 alırsa kutu işaretsiz ve gizli olmalı, dördüncü anahtar yeniden onay istemeli. (Home Assistant'ın `ip_ban` ayarı açıkken yalnız 2 deneme yapın.)
- [ ] **403 duraklatması (yalnız kendi ağınızda, ban simülasyonu):** Home Assistant adresine erişim 403 verdiğinde (ör. ters vekilde engelleyerek) uygulama o adrese 15 dk kimlikli istek göndermemeli, anahtar "reddedildi" sayılmamalı, günlükte tek *"duraklatıldı"* satırı olmalı.

---

## Bilinen Sınırlar

- Görsel sonuçlar (Akrilik/Mica, koyu başlık çubuğu, vurgu rengi) ve tepsi taşma alanı davranışı gerçek Windows'ta denenmedi (bkz. Dalga 4 listesi).
- Özel tam ekran oyunların üstünde kısayol/panel/köşe bildirimi görünürlüğü denenmedi.
- Tam ekran (`F11`) durumu ve pencere konumu hatırlanmaz; geniş modun yalnız büyütülmüş durumu hatırlanır.
- Oturum adres (köken) başınadır: ev içi ve dış adreste ayrı giriş gerekir.
- Adında `kilit` geçen her varlık (bilgisayar kilitleme dahil) kapı kuralı gereği favori olamaz.
- Script ya da sahnenin içeriği denetlenmez.
- 1.4.0 ile gelen dış tetikler, yerel API, `evpaneli://`, PC olayları, toplantı ışığı, mobil bildirimler, uygulama içi güncelleme, klasörle eşitleme, özel sertifika, tarayıcıyla giriş ve "basılı tutunca göster" yalnız sahte (mock) bağlantılarla sınandı; gerçek Windows ve gerçek Home Assistant üzerinde elle denenmedi. Aynı şekilde 1.4.0'ın yeni karo ve ayar ekranları (iklim aralığı, sensör göstergesi, kamera büyütme, emoji seçici, içe aktarma önizlemesi, masaüstüne sabitleme menüsü, rozet dönüşü) yalnız sahte DOM ve sahte ana süreç ile sınandı; görünümleri gerçek Windows'ta elle denenmelidir. "Basılı tutunca göster" için elle deneme: ana kısayolu basılı tutun (panel açık kalmalı), bırakınca kapanmalı.
- Bildirim düğmesinden ya da bildirimden "Dış tetikler" ayarına doğrudan geçiş yoktur; bölüm Ayarlar'dan elle açılır.
