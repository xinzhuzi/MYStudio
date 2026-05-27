; 安装完成后刷新 Windows 图标缓存，确保新图标立即生效
!macro customInstall
  ; 通知 Windows Shell 图标已更改
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x0000, p 0, p 0)'

  ; 额外调用 ie4uinit 刷新图标缓存
  nsExec::ExecToLog 'ie4uinit.exe -show'
!macroend
