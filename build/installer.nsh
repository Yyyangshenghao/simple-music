!ifndef MUI_BGCOLOR
  !define MUI_BGCOLOR "FFFFFF"
!endif
!ifndef MUI_TEXTCOLOR
  !define MUI_TEXTCOLOR "111217"
!endif
!ifndef MUI_DIRECTORYPAGE_BGCOLOR
  !define MUI_DIRECTORYPAGE_BGCOLOR "FFFFFF"
!endif
!ifndef MUI_DIRECTORYPAGE_TEXTCOLOR
  !define MUI_DIRECTORYPAGE_TEXTCOLOR "111217"
!endif
!ifndef MUI_INSTFILESPAGE_COLORS
  !define MUI_INSTFILESPAGE_COLORS "5227FF FFFFFF"
!endif
!ifndef MUI_FINISHPAGE_LINK_COLOR
  !define MUI_FINISHPAGE_LINK_COLOR "5227FF"
!endif
!ifndef MUI_HEADERIMAGE
  !define MUI_HEADERIMAGE
!endif
!ifndef MUI_HEADERIMAGE_BITMAP_STRETCH
  !define MUI_HEADERIMAGE_BITMAP_STRETCH "FitControl"
!endif
!ifndef MUI_HEADERIMAGE_UNBITMAP_STRETCH
  !define MUI_HEADERIMAGE_UNBITMAP_STRETCH "FitControl"
!endif

!ifndef BUILD_UNINSTALLER
  !ifndef MUI_CUSTOMFUNCTION_GUIINIT
    !define MUI_CUSTOMFUNCTION_GUIINIT SimpleMusicGuiInit
  !endif
!else
  !ifndef MUI_CUSTOMFUNCTION_UNGUIINIT
    !define MUI_CUSTOMFUNCTION_UNGUIINIT un.SimpleMusicGuiInit
  !endif
!endif

!include LogicLib.nsh
!include FileFunc.nsh
!include nsDialogs.nsh
!include WinMessages.nsh
!include "${PROJECT_DIR}/build/windows-files.nsh"
!include "${PROJECT_DIR}/build/windows-processes.nsh"

!ifdef BUILD_UNINSTALLER
  !include "${PROJECT_DIR}/dist/nsis-safe/remove-files.nsh"
!else
  !include "${PROJECT_DIR}/dist/nsis-safe/install-files.nsh"
  !define MUI_CUSTOMFUNCTION_ABORT SimpleMusicAbort
!endif

!macro customHeader
  !ifdef BUILD_UNINSTALLER
    !insertmacro SimpleMusicPathFunctions "un."
    !insertmacro SimpleMusicRemovalFunctions
  !else
    !insertmacro SimpleMusicPathFunctions ""
    !insertmacro SimpleMusicInstallFunctions
    !addincludedir "${PROJECT_DIR}/node_modules/app-builder-lib/templates/nsis"
    !cd "${PROJECT_DIR}/dist/nsis-safe"
  !endif
!macroend

!ifndef BUILD_UNINSTALLER
  Var SimpleMusicWelcomePage
  Var SimpleMusicHeroFont
  Var SimpleMusicTitleFont
  Var SimpleMusicBodyFont
  Var SimpleMusicSmallFont
  Var SimpleMusicDirectoryPage
  Var SimpleMusicDirectoryInput
!else
  Var SimpleMusicUnWelcomePage
  Var SimpleMusicHeroFont
  Var SimpleMusicTitleFont
  Var SimpleMusicBodyFont
  Var SimpleMusicSmallFont
!endif

!macro customInit
  !ifndef BUILD_UNINSTALLER
    !insertmacro SimpleMusicValidateInstallDirectory
    Call SimpleMusicSelectInstallDirectory
  !endif
!macroend

!macro customWelcomePage
  Page custom SimpleMusicWelcomeShow
!macroend

!macro customUnWelcomePage
  UninstPage custom un.SimpleMusicUnWelcomeShow
!macroend

!macro customUnInstall
  ; 显式清理用户数据也不能穿过目录联接删到其他位置。
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "--delete-app-data" $1
  ${IfNot} ${Errors}
    !insertmacro SimpleMusicCheckPath "un." "$APPDATA\${APP_FILENAME}"
    !ifdef APP_PRODUCT_FILENAME
      !insertmacro SimpleMusicCheckPath "un." "$APPDATA\${APP_PRODUCT_FILENAME}"
    !endif
    !ifdef APP_PACKAGE_NAME
      !insertmacro SimpleMusicCheckPath "un." "$APPDATA\${APP_PACKAGE_NAME}"
    !endif
  ${EndIf}
!macroend

!macro customInstallMode
  !ifndef BUILD_UNINSTALLER
    ${If} $hasPerMachineInstallation != "1"
      StrCpy $isForceCurrentInstall "1"
    ${EndIf}
  !endif
!macroend

; 安装段在任何写入或旧版处理之前再次调用，覆盖静默安装及页面重置路径。
!macro SimpleMusicValidateInstallDirectory
  Call SimpleMusicValidateInstallDirectory
!macroend

!macro customPageAfterChangeDir
  Page custom SimpleMusicDirectoryShow SimpleMusicDirectoryLeave
!macroend

!macro customFinishPage
  !ifndef HIDE_RUN_AFTER_FINISH
    Function SimpleMusicFinishStartApp
      ${If} ${isUpdated}
        StrCpy $1 "--updated"
      ${Else}
        StrCpy $1 ""
      ${EndIf}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    FunctionEnd

    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_FUNCTION "SimpleMusicFinishStartApp"
  !endif
  !insertmacro MUI_PAGE_FINISH
!macroend

; 深色标题栏 + 常驻按钮(上一步/下一步/取消)着色,安装器和卸载器共用同一份实现。
; NSIS 要求卸载上下文里被 Call 的函数名必须带 un. 前缀,因此正文写成宏,两边各自套一层同名/un. 前缀的 Function。
!macro SimpleMusicTintCommonControlsBody
  SetCtlColors $HWNDPARENT "111217" "FFFFFF"

  GetDlgItem $0 $HWNDPARENT 1
  ${If} $0 <> 0
    SetCtlColors $0 "111217" "FFFFFF"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 2
  ${If} $0 <> 0
    SetCtlColors $0 "111217" "FFFFFF"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 3
  ${If} $0 <> 0
    SetCtlColors $0 "111217" "FFFFFF"
  ${EndIf}

  GetDlgItem $0 $HWNDPARENT 1028
  ${If} $0 <> 0
    SetCtlColors $0 "4B5263" "FFFFFF"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1256
  ${If} $0 <> 0
    SetCtlColors $0 "4B5263" "FFFFFF"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1034
  ${If} $0 <> 0
    SetCtlColors $0 "" "FFFFFF"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1035
  ${If} $0 <> 0
    SetCtlColors $0 "" "FFFFFF"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1037
  ${If} $0 <> 0
    SetCtlColors $0 "111217" "FFFFFF"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1038
  ${If} $0 <> 0
    SetCtlColors $0 "4B5263" "FFFFFF"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1039
  ${If} $0 <> 0
    SetCtlColors $0 "" "FFFFFF"
  ${EndIf}

  FindWindow $0 "#32770" "" $HWNDPARENT
  ${If} $0 <> 0
    SetCtlColors $0 "111217" "FFFFFF"

    GetDlgItem $1 $0 1000
    ${If} $1 <> 0
      SetCtlColors $1 "111217" "FFFFFF"
    ${EndIf}
    GetDlgItem $1 $0 1001
    ${If} $1 <> 0
      SetCtlColors $1 "111217" "FFFFFF"
    ${EndIf}
    GetDlgItem $1 $0 1004
    ${If} $1 <> 0
      SetCtlColors $1 "5227FF" "FFFFFF"
    ${EndIf}
    GetDlgItem $1 $0 1006
    ${If} $1 <> 0
      SetCtlColors $1 "4B5263" "FFFFFF"
    ${EndIf}
    GetDlgItem $1 $0 1016
    ${If} $1 <> 0
      SetCtlColors $1 "4B5263" "FFFFFF"
    ${EndIf}
    GetDlgItem $1 $0 1019
    ${If} $1 <> 0
      SetCtlColors $1 "111217" "FFFFFF"
    ${EndIf}
    GetDlgItem $1 $0 1020
    ${If} $1 <> 0
      SetCtlColors $1 "4B5263" "FFFFFF"
    ${EndIf}
    GetDlgItem $1 $0 1023
    ${If} $1 <> 0
      SetCtlColors $1 "4B5263" "FFFFFF"
    ${EndIf}
    GetDlgItem $1 $0 1024
    ${If} $1 <> 0
      SetCtlColors $1 "4B5263" "FFFFFF"
    ${EndIf}
    GetDlgItem $1 $0 1027
    ${If} $1 <> 0
      SetCtlColors $1 "111217" "FFFFFF"
    ${EndIf}
    GetDlgItem $1 $0 1201
    ${If} $1 <> 0
      SetCtlColors $1 "111217" "FFFFFF"
    ${EndIf}
    GetDlgItem $1 $0 1202
    ${If} $1 <> 0
      SetCtlColors $1 "4B5263" "FFFFFF"
    ${EndIf}
    GetDlgItem $1 $0 1203
    ${If} $1 <> 0
      SetCtlColors $1 "111217" "FFFFFF"
    ${EndIf}
    GetDlgItem $1 $0 1204
    ${If} $1 <> 0
      SetCtlColors $1 "4B5263" "FFFFFF"
    ${EndIf}
  ${EndIf}
!macroend

!ifndef BUILD_UNINSTALLER

Function SimpleMusicGuiInit
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 20, *i 1, i 4) i .r0'
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 19, *i 1, i 4) i .r0'
  Call SimpleMusicTintCommonControls
FunctionEnd

Function SimpleMusicTintCommonControls
  !insertmacro SimpleMusicTintCommonControlsBody
FunctionEnd

Function SimpleMusicNormalizeInstallDir
  Exch $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  StrCpy $5 "0"

  ; /D= 已由 electron-builder 的 initMultiUser 解析，不再用 GetParameters 重复读取。
  StrLen $1 "$0"
  ${If} $1 == 2
    StrCpy $2 "$0" 1 1
    ${If} $2 == ":"
      StrCpy $0 "$0\Simple Music"
    ${EndIf}
  ${ElseIf} $1 == 3
    StrCpy $2 "$0" 1 1
    StrCpy $3 "$0" 1 2
    ${If} $2 == ":"
    ${AndIf} $3 == "\"
      StrCpy $0 "$0Simple Music"
    ${EndIf}
  ${EndIf}

  ; 仅接受盘符绝对路径，拒绝相对、UNC、设备路径及无效盘符。
  System::Call 'shlwapi::PathGetDriveNumberW(w r0) i .r1'
  ${If} $1 < 0
    Goto simple_music_invalid_directory
  ${EndIf}
  StrCpy $1 "$0" 2 1
  ${If} $1 != ":\"
    Goto simple_music_invalid_directory
  ${EndIf}
  System::Call 'kernel32::GetFullPathNameW(w r0, i ${NSIS_MAX_STRLEN}, w .r2, p 0) i .r1'
  ${If} $1 <= 0
  ${OrIf} $1 >= ${NSIS_MAX_STRLEN}
    Goto simple_music_invalid_directory
  ${EndIf}
  StrCpy $0 "$2"
  ; 已存在的路径展开 8.3 别名；未创建的路径继续按规范化绝对路径检查。
  System::Call 'kernel32::GetLongPathNameW(w r0, w .r2, i ${NSIS_MAX_STRLEN}) i .r1'
  ${If} $1 > 0
  ${AndIf} $1 < ${NSIS_MAX_STRLEN}
    StrCpy $0 "$2"
  ${EndIf}

  ; 统一尾部分隔符，避免 C:\Windows\ 等写法绕过目录比较。
simple_music_trim_directory:
  StrLen $1 "$0"
  ${If} $1 > 3
    StrCpy $2 "$0" 1 -1
    ${If} $2 == "\"
      StrCpy $0 "$0" -1
      Goto simple_music_trim_directory
    ${EndIf}
  ${EndIf}
  ${If} $1 == 3
    StrCpy $0 "$0Simple Music"
  ${EndIf}

  ; Win32 会特殊解释这些字符及以点/空格结尾的路径分段，不能交给解压器猜测。
  StrCpy $1 0
simple_music_check_directory_char:
  StrCpy $2 "$0" 1 $1
  ${If} $2 == ""
    Goto simple_music_check_directory_roots
  ${EndIf}
  ${If} $2 == '*'
  ${OrIf} $2 == '?'
  ${OrIf} $2 == '$\"'
  ${OrIf} $2 == '<'
  ${OrIf} $2 == '>'
  ${OrIf} $2 == '|'
  ${OrIf} $2 == '/'
    Goto simple_music_invalid_directory
  ${EndIf}
  ${If} $2 == ":"
  ${AndIf} $1 != 1
    Goto simple_music_invalid_directory
  ${EndIf}
  ${If} $2 == "\"
  ${AndIf} $1 > 2
    IntOp $3 $1 - 1
    StrCpy $4 "$0" 1 $3
    ${If} $4 == "."
    ${OrIf} $4 == " "
      Goto simple_music_invalid_directory
    ${EndIf}
  ${EndIf}
  IntOp $1 $1 + 1
  Goto simple_music_check_directory_char

simple_music_check_directory_roots:
  StrCpy $2 "$0" 1 -1
  ${If} $2 == "."
  ${OrIf} $2 == " "
    Goto simple_music_invalid_directory
  ${EndIf}
  ${If} $0 == "$PROFILE"
  ${OrIf} $0 == "$DESKTOP"
  ${OrIf} $0 == "$DOCUMENTS"
  ${OrIf} $0 == "$APPDATA"
  ${OrIf} $0 == "$LOCALAPPDATA"
  ${OrIf} $0 == "$LOCALAPPDATA\Programs"
  ${OrIf} $0 == "$PROGRAMFILES"
  ${OrIf} $0 == "$PROGRAMFILES64"
  ${OrIf} $0 == "$COMMONFILES"
  ${OrIf} $0 == "$COMMONFILES64"
  ${OrIf} $0 == "$TEMP"
    Goto simple_music_invalid_directory
  ${EndIf}
  ${GetParent} "$PROFILE" $1
  ${If} $0 == $1
    Goto simple_music_invalid_directory
  ${EndIf}
  ; Windows 系统目录及其子目录始终不能作为程序安装位置。
  StrCpy $1 "$0"
simple_music_check_windows_parent:
  System::Call 'kernel32::GetLongPathNameW(w r1, w .r3, i ${NSIS_MAX_STRLEN}) i .r2'
  ${If} $2 > 0
  ${AndIf} $2 < ${NSIS_MAX_STRLEN}
    StrCpy $1 "$3"
  ${EndIf}
  ${If} $1 == "$WINDIR"
    Goto simple_music_invalid_directory
  ${EndIf}
  ${GetParent} "$1" $2
  ${If} $2 != ""
  ${AndIf} $2 != $1
    StrCpy $1 "$2"
    Goto simple_music_check_windows_parent
  ${EndIf}
  Goto simple_music_directory_done

simple_music_invalid_directory:
  StrCpy $5 "1"
simple_music_directory_done:
  StrCpy $1 "$5"
  ${If} $1 == "1"
    SetErrors
  ${Else}
    ClearErrors
  ${EndIf}
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Exch $0
FunctionEnd

Function SimpleMusicValidateInstallDirectory
  Push $0
  Push "$INSTDIR"
  Call SimpleMusicNormalizeInstallDir
  Pop $0
  ${If} ${Errors}
    Pop $0
    MessageBox MB_ICONEXCLAMATION|MB_OK "请选择磁盘中的独立安装文件夹，不能使用系统目录或个人文件夹根目录。" /SD IDOK
    SetErrorLevel 2
    Abort
  ${EndIf}
  StrCpy $INSTDIR "$0"
  Pop $0
FunctionEnd

Function SimpleMusicWelcomeShow
  nsDialogs::Create 1018
  Pop $SimpleMusicWelcomePage
  ${If} $SimpleMusicWelcomePage == error
    Abort
  ${EndIf}

  SetCtlColors $SimpleMusicWelcomePage "111217" "FFFFFF"
  CreateFont $SimpleMusicHeroFont "Microsoft YaHei UI" 24 700
  CreateFont $SimpleMusicTitleFont "Microsoft YaHei UI" 11 700
  CreateFont $SimpleMusicBodyFont "Microsoft YaHei UI" 9 400
  CreateFont $SimpleMusicSmallFont "Microsoft YaHei UI" 8 400

  ${NSD_CreateLabel} 22u 20u 82u 10u "SIMPLE MUSIC"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $SimpleMusicSmallFont 1
  SetCtlColors $0 "5227FF" "FFFFFF"

  ${NSD_CreateLabel} 22u 42u 226u 30u "Simple Music 安装"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $SimpleMusicHeroFont 1
  SetCtlColors $0 "111217" "FFFFFF"

  ${NSD_CreateLabel} 22u 78u 36u 2u ""
  Pop $0
  SetCtlColors $0 "" "5227FF"

  ${NSD_CreateLabel} 22u 96u 238u 24u "为这台电脑安装 Simple Music。下一步可以自由选择安装位置。"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $SimpleMusicBodyFont 1
  SetCtlColors $0 "4B5263" "FFFFFF"

  ${NSD_CreateLabel} 22u 130u 238u 12u "默认位置：$INSTDIR"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $SimpleMusicTitleFont 1
  SetCtlColors $0 "5227FF" "FFFFFF"

  nsDialogs::Show
FunctionEnd

Function SimpleMusicDirectoryBrowse
  nsDialogs::SelectFolderDialog "选择 Simple Music 安装文件夹" "$INSTDIR"
  Pop $0
  ${If} $0 != error
  ${AndIf} $0 != ""
    Push "$0"
    Call SimpleMusicNormalizeInstallDir
    Pop $0
    StrCpy $INSTDIR "$0"
    SendMessage $SimpleMusicDirectoryInput ${WM_SETTEXT} 0 "STR:$INSTDIR"
  ${EndIf}
FunctionEnd

Function SimpleMusicDirectoryShow
  Call SimpleMusicSelectInstallDirectory
  nsDialogs::Create 1018
  Pop $SimpleMusicDirectoryPage
  ${If} $SimpleMusicDirectoryPage == error
    Abort
  ${EndIf}

  SetCtlColors $SimpleMusicDirectoryPage "111217" "FFFFFF"
  CreateFont $SimpleMusicTitleFont "Microsoft YaHei UI" 15 700
  CreateFont $SimpleMusicBodyFont "Microsoft YaHei UI" 9 400
  CreateFont $SimpleMusicSmallFont "Microsoft YaHei UI" 8 500

  ${NSD_CreateLabel} 22u 12u 238u 20u "选择安装位置"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $SimpleMusicTitleFont 1
  SetCtlColors $0 "111217" "FFFFFF"

  ${NSD_CreateLabel} 22u 40u 238u 24u "你可以使用默认路径，也可以选择其它磁盘或文件夹。安装器会自动创建缺失的目录。"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $SimpleMusicBodyFont 1
  SetCtlColors $0 "4B5263" "FFFFFF"

  ${NSD_CreateLabel} 22u 76u 238u 10u "安装目录"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $SimpleMusicSmallFont 1
  SetCtlColors $0 "5227FF" "FFFFFF"

  ${NSD_CreateText} 22u 94u 178u 15u "$INSTDIR"
  Pop $SimpleMusicDirectoryInput
  SendMessage $SimpleMusicDirectoryInput ${WM_SETFONT} $SimpleMusicBodyFont 1
  SetCtlColors $SimpleMusicDirectoryInput "111217" "FFFFFF"

  ${NSD_CreateBrowseButton} 210u 93u 50u 17u "浏览..."
  Pop $0
  SendMessage $0 ${WM_SETFONT} $SimpleMusicSmallFont 1
  ${NSD_OnClick} $0 SimpleMusicDirectoryBrowse

  ${NSD_CreateLabel} 22u 122u 238u 12u "选盘符会自动建 Simple Music 子文件夹。"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $SimpleMusicSmallFont 1
  SetCtlColors $0 "6B7280" "FFFFFF"

  nsDialogs::Show
FunctionEnd

Function SimpleMusicDirectoryLeave
  ${NSD_GetText} $SimpleMusicDirectoryInput $0
  StrCpy $INSTDIR "$0"
  !insertmacro SimpleMusicValidateInstallDirectory
  Call SimpleMusicSelectInstallDirectory
  SendMessage $SimpleMusicDirectoryInput ${WM_SETTEXT} 0 "STR:$INSTDIR"
FunctionEnd

!else

Function un.SimpleMusicGuiInit
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 20, *i 1, i 4) i .r0'
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 19, *i 1, i 4) i .r0'
  Call un.SimpleMusicTintCommonControls
FunctionEnd

Function un.SimpleMusicTintCommonControls
  !insertmacro SimpleMusicTintCommonControlsBody
FunctionEnd

Function un.SimpleMusicUnWelcomeShow
  nsDialogs::Create 1018
  Pop $SimpleMusicUnWelcomePage
  ${If} $SimpleMusicUnWelcomePage == error
    Abort
  ${EndIf}

  SetCtlColors $SimpleMusicUnWelcomePage "111217" "FFFFFF"
  CreateFont $SimpleMusicHeroFont "Microsoft YaHei UI" 24 700
  CreateFont $SimpleMusicTitleFont "Microsoft YaHei UI" 11 700
  CreateFont $SimpleMusicBodyFont "Microsoft YaHei UI" 9 400
  CreateFont $SimpleMusicSmallFont "Microsoft YaHei UI" 8 400

  ${NSD_CreateLabel} 22u 20u 82u 10u "SIMPLE MUSIC"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $SimpleMusicSmallFont 1
  SetCtlColors $0 "5227FF" "FFFFFF"

  ${NSD_CreateLabel} 22u 42u 226u 30u "卸载 Simple Music"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $SimpleMusicHeroFont 1
  SetCtlColors $0 "111217" "FFFFFF"

  ${NSD_CreateLabel} 22u 78u 36u 2u ""
  Pop $0
  SetCtlColors $0 "" "5227FF"

  ${NSD_CreateLabel} 22u 96u 238u 24u "即将从这台电脑移除 Simple Music 程序文件。点击下一步继续，或点击取消放弃卸载。"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $SimpleMusicBodyFont 1
  SetCtlColors $0 "4B5263" "FFFFFF"

  ${NSD_CreateLabel} 22u 130u 238u 12u "卸载位置：$INSTDIR"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $SimpleMusicTitleFont 1
  SetCtlColors $0 "5227FF" "FFFFFF"

  nsDialogs::Show
FunctionEnd

!endif
