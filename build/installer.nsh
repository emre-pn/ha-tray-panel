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

!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Ev Paneli"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "Ev Paneli"
  ${endIf}
!macroend
