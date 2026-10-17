# Security Policy

## Supported versions

Only the latest release gets security fixes.

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's private vulnerability reporting instead: go to the repository's **Security** tab and choose **Report a vulnerability**. You should get a reply within a week.

Things we especially want to hear about:

- any way to show, favorite, bind to a hotkey or run a lock, alarm panel, door, garage door, gate or intercom (bypassing the door rule);
- the access token being sent to an unverified address, written to a log or included in an export;
- ways around the auth circuit breaker or the hold-to-confirm step;
- any way to start a valve, an automation, a camera picture or an action that asks for confirmation from outside the app (local API, `evpaneli://`, Jump List, desktop shortcut, PC event, meeting light, folder sync);
- the local API being reachable from another computer or from a web page;
- secrets (access or refresh token, passphrase, webhook id, custom header values, local API token) showing up in a log, an export, a synced folder or an error message.

Never include a real access token, address or other personal data in a report.

## What the optional features open

The features below are all off by default. Each line says what turning it on opens.

- **Local API:** listens on `127.0.0.1` only. It accepts POST requests with a JSON body and a bearer token (stored with Electron `safeStorage`), refuses anything that looks like a browser request and sends no CORS headers. A program running as your Windows user that has the token can switch the harmless favorites you named; nothing more.
- **`evpaneli://` links:** while the option is on, the app registers the link scheme for the current user (HKCU) and removes it again when the option is turned off or the app quits. A web page can open such a link, so the quick panel asks (allow once, always, deny) for each favorite.
- **Jump List, desktop shortcuts, PC events, meeting light:** start the same harmless favorites by name through the same gate. The meeting light only reads Windows' own microphone and camera usage flags and never records which program uses them.
- **Mobile app registration:** after you press Register, this PC shows up in Home Assistant as a mobile app. The webhook id is stored with `safeStorage`. Only the notification-action event goes back to Home Assistant; no sensors or location are sent. Remove the device in Home Assistant when you are done.
- **Browser sign-in, custom headers, private CA or fingerprint pinning:** the refresh token and header values are stored with `safeStorage`. Headers go only to your two Home Assistant origins, and the extra trust applies only to your Home Assistant host. There is no option to ignore certificate errors.
- **Folder sync:** writes preferences, never secrets or addresses, to the folder you choose (optionally encrypted with a passphrase). Whatever is read back goes through the same checks as an import, including the door rule.
- **Camera snapshots:** one picture at a time, fetched by the main process, kept in memory only and hidden from screen capture while allowed. Door, doorbell, intercom and entrance cameras are never offered.
- **Update check and in-app updates:** the only requests that leave for a server other than your Home Assistant, and only to GitHub Releases. Your address and token are never sent. The installer's sha512 is checked before it is installed.

## Trust boundary

- **Release channel:** the installer is not code-signed. What protects an in-app update is the GitHub account that publishes the release and the sha512 check; if that account were taken over, a malicious release would pass those checks. This is why in-app updates are off by default and install only after a second confirmation. Verify the SHA-256 listed in each release if that matters to you.
- **Local API:** a program that runs as your Windows user and knows the token can use it, and five wrong tokens within a minute lock the API for a minute for everyone, so a local program can also keep the real client out for a moment. That is an accepted risk; it grants nothing.
- **Mobile notification buttons:** a button press only sends the standard notification-action event to Home Assistant. The app cannot know which automation listens to it, so never bind an automation that opens a door, lock, garage or alarm to that event.

## Türkçe

Güvenlik sorunlarını herkese açık issue olarak açma; deponun **Security** sekmesindeki **Report a vulnerability** seçeneğiyle gizli olarak bildir. Bildirimine gerçek erişim anahtarı, adres ya da kişisel veri koyma.

Seçenekli özellikler (yerel API, `evpaneli://` bağlantıları, dış tetikler, mobil bildirim kaydı, klasörle eşitleme, kamera, güncelleme) varsayılan olarak kapalıdır. Yerel API yalnız 127.0.0.1'de dinler ve jetonla çalışır; `evpaneli://` açıkken her favori için panelde izin sorulur; mobil kayıtta Home Assistant'a yalnız bildirim düğmesi olayı gider, sensör ya da konum gitmez. Vana, otomasyon, kamera ve onay isteyen eylemler uygulamanın dışından hiçbir yolla başlatılamaz. Ayrıntı için yukarıdaki "What the optional features open" bölümüne bak.

Güven sınırı: kurucu imzasızdır; uygulama içi güncellemeyi yalnız sürümü yayımlayan GitHub hesabı ve sha512 denetimi korur. Yerel API'de art arda yanlış jeton geçici ve genel bir kilit getirir (aynı bilgisayardaki bir program gerçek istemciyi kısa süre dışarıda bırakabilir; yetki vermez). Bildirim düğmesine basınca Home Assistant'ta hangi otomasyonun çalışacağı bilinemez; kapı, kilit, garaj ya da alarm açan bir otomasyonu bu olaya bağlama.
