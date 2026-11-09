!ifndef SIMPLE_MUSIC_WINDOWS_PROCESSES
!define SIMPLE_MUSIC_WINDOWS_PROCESSES

; 不使用上游按目录前缀匹配/强杀进程的实现。路径通过环境传递，不拼入 PowerShell 代码。
!macro customCheckAppRunning
  Push $R0
  Push $R1
  Push $R2
  Push $R3

  GetFullPathName $R2 "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  System::Call 'kernel32::SetEnvironmentVariableW(w "SIMPLE_MUSIC_INSTALL_EXE", w R2)'

  ReadRegStr $R2 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $R2 != ""
    GetFullPathName $R2 "$R2\${APP_EXECUTABLE_FILENAME}"
  ${EndIf}
  System::Call 'kernel32::SetEnvironmentVariableW(w "SIMPLE_MUSIC_USER_EXE", w R2)'

  ReadRegStr $R2 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $R2 != ""
    GetFullPathName $R2 "$R2\${APP_EXECUTABLE_FILENAME}"
  ${EndIf}
  System::Call 'kernel32::SetEnvironmentVariableW(w "SIMPLE_MUSIC_MACHINE_EXE", w R2)'

  StrCpy $R3 0
  ${Do}
    ; -contains 为完整路径、不区分大小写的匹配，也包含使用同一 exe 的 Electron 子进程。
    nsExec::ExecToStack /TIMEOUT=30000 `"$PowerShellPath" -NoLogo -NoProfile -NonInteractive -Command "$$ErrorActionPreference='Stop'; try { $$paths=@($$env:SIMPLE_MUSIC_INSTALL_EXE,$$env:SIMPLE_MUSIC_USER_EXE,$$env:SIMPLE_MUSIC_MACHINE_EXE); $$running=@(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $$_.ExecutablePath -and ($$paths -contains $$_.ExecutablePath) }); if ($$running.Count -gt 0) { exit 1 }; exit 0 } catch { exit 2 }"`
    Pop $R0
    Pop $R1
    ${If} $R0 == "0"
      ${ExitDo}
    ${EndIf}
    ${If} $R0 != "1"
      DetailPrint "Cannot check application processes: $R0 $R1"
      MessageBox MB_OK|MB_ICONEXCLAMATION "无法确认 Simple Music 是否已退出，已停止操作。请关闭应用后重试。" /SD IDOK
      SetErrorLevel 2
      Quit
    ${EndIf}
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONEXCLAMATION "请先退出 Simple Music，再重新运行安装或卸载程序。" /SD IDOK
      SetErrorLevel 2
      Quit
    ${EndIf}
    ; 应用内更新先启动安装器再退出。只等待，不强行结束任何进程。
    IntOp $R3 $R3 + 1
    ${If} $R3 >= 10
      DetailPrint "Simple Music is still running; no files changed."
      SetErrorLevel 2
      Quit
    ${EndIf}
    Sleep 500
  ${Loop}

  System::Call 'kernel32::SetEnvironmentVariableW(w "SIMPLE_MUSIC_INSTALL_EXE", p 0)'
  System::Call 'kernel32::SetEnvironmentVariableW(w "SIMPLE_MUSIC_USER_EXE", p 0)'
  System::Call 'kernel32::SetEnvironmentVariableW(w "SIMPLE_MUSIC_MACHINE_EXE", p 0)'

  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
!macroend

!endif
