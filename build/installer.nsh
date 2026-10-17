; Ev Paneli — NSIS ek komutları (electron-builder "include" ile eklenir)
;
; Uygulama, otomatik başlatma için HKCU\...\Run altına "Ev Paneli" adlı bir değer yazar
; (app.setLoginItemSettings, name: "Ev Paneli"). Bu değer ve Görev Yöneticisi'ndeki onay kaydı
; (Explorer\StartupApproved\Run) YALNIZ gerçek kaldırmada silinir.
;
; Güncellemede electron-builder önce kurulu sürümün kaldırıcısını "--updated" bayrağıyla çalıştırır
; (isUpdated bu bayrağı sınar; şablonlardaki uninstaller.nsh de aynı koşulu kullanır). O durumda kayıt ve
; kullanıcının Windows'ta verdiği "kapalı" işareti OLDUĞU GİBİ kalır: güncelleme, kapatılmış otomatik
; başlatmayı geri açmaz, açık olanı da silmez.
;
; Dikkat: güncellemede çalışan, KURULU sürümün kaldırıcısıdır. Bu düzeltme bu yüzden 1.1.0'dan SONRAKİ
; güncellemelerde etkili olur; 1.0.0 -> 1.1.0 güncellemesinde 1.0.0'ın kaldırıcısı kaydı yine siler ve
; 1.1.0 ilk açılışta kaydı ayarlar.json'daki seçime göre yeniden yazar.
;
; 1.4.0 (o-54): "evpaneli:// bağlantıları" seçeneği açıkken uygulama HKCU\Software\Classes\evpaneli anahtarını
; yazar (app.setAsDefaultProtocolClient; seçenek kapanınca kendisi kaldırır). Gerçek kaldırmada anahtar, komutu
; BU kurulumun exe'sini gösteriyorsa silinir; başka bir programın kaydına dokunulmaz. Güncellemede kalır.

!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Ev Paneli"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "Ev Paneli"
    Push $0
    Push $1
    ReadRegStr $0 HKCU "Software\Classes\evpaneli\shell\open\command" ""
    StrLen $1 "$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\""
    StrCpy $0 $0 $1
    ${if} $0 == "$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\""
      DeleteRegKey HKCU "Software\Classes\evpaneli"
    ${endIf}
    Pop $1
    Pop $0
  ${endIf}
!macroend
