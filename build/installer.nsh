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
  !define MUI_INSTFILESPAGE_COLORS "3978B8 FFFFFF"
!endif
!ifndef MUI_FINISHPAGE_LINK_COLOR
  !define MUI_FINISHPAGE_LINK_COLOR "3978B8"
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
!define MUI_WELCOMEFINISHPAGE_BITMAP_STRETCH "FitControl"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP_STRETCH "FitControl"

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
!include MUI2.nsh
!include "${PROJECT_DIR}\build\windows-files.nsh"
!include "${PROJECT_DIR}\build\windows-processes.nsh"

!ifdef BUILD_UNINSTALLER
  !include "${PROJECT_DIR}\dist\nsis-safe\remove-files.nsh"
!else
  !include "${PROJECT_DIR}\dist\nsis-safe\install-files.nsh"
  !define MUI_CUSTOMFUNCTION_ABORT SimpleMusicAbort
!endif

!macro customHeader
  SetFont "Microsoft YaHei UI" 9
  BrandingText " "
  !ifdef BUILD_UNINSTALLER
    !insertmacro SimpleMusicFinishTypography "un."
  !else
    !insertmacro SimpleMusicFinishTypography ""
  !endif
  !ifdef BUILD_UNINSTALLER
    !insertmacro SimpleMusicPathFunctions "un."
    !insertmacro SimpleMusicRemovalFunctions
  !else
    !insertmacro SimpleMusicPathFunctions ""
    !insertmacro SimpleMusicDirectoryFunctions
    !insertmacro SimpleMusicInstallFunctions
    !addincludedir "${PROJECT_DIR}\node_modules\app-builder-lib\templates\nsis"
    !cd "${PROJECT_DIR}\dist\nsis-safe"
  !endif
!macroend

!ifndef BUILD_UNINSTALLER
  Var SimpleMusicTitleFont
  Var SimpleMusicBodyFont
  Var SimpleMusicSmallFont
  Var SimpleMusicDirectoryPage
  Var SimpleMusicDirectoryInput
  Var SimpleMusicDirectoryPreview
  Var SimpleMusicDirectoryStatus
  Var SimpleMusicDirectoryValid
  Var SimpleMusicDirectoryConfirmed
  Var SimpleMusicDirectoryLastPreview
!else
  Var SimpleMusicUnWelcomePage
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
  ; 直接进入位置确认页，避免无操作的欢迎页。
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
  !define MUI_FINISHPAGE_TITLE "安装完成"
  !define MUI_FINISHPAGE_TEXT "Simple Music 已安装到：$\r$\n$INSTDIR"
  !define MUI_FINISHPAGE_RUN_TEXT "启动 Simple Music"
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
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW SimpleMusicFinishShow
  !insertmacro MUI_PAGE_FINISH
!macroend

; electron-builder 在这个钩子之后声明卸载完成页。
!macro customUninstallPage
  !define MUI_FINISHPAGE_TITLE "卸载完成"
  !define MUI_FINISHPAGE_TEXT "Simple Music 程序文件已移除。$\r$\n$\r$\n安装目录中的额外文件会保留。"
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW un.SimpleMusicFinishShow
!macroend

!macro SimpleMusicFinishTypography PREFIX
Function ${PREFIX}SimpleMusicFinishShow
  SendMessage $mui.FinishPage.Title ${WM_SETFONT} $SimpleMusicTitleFont 1
  SendMessage $mui.FinishPage.Text ${WM_SETFONT} $SimpleMusicBodyFont 1
  SetCtlColors $mui.FinishPage.Title "1F2937" "FFFFFF"
  SetCtlColors $mui.FinishPage.Text "596579" "FFFFFF"
FunctionEnd
!macroend

; 常驻按钮和内容使用同一套浅色表面，安装器和卸载器共用。
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
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 20, *i 0, i 4) i .r0'
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 19, *i 0, i 4) i .r0'
  Call SimpleMusicTintCommonControls
  CreateFont $SimpleMusicTitleFont "Microsoft YaHei UI" 13 600
  CreateFont $SimpleMusicBodyFont "Microsoft YaHei UI" 9 400
  CreateFont $SimpleMusicSmallFont "Microsoft YaHei UI" 9 400
FunctionEnd

Function SimpleMusicTintCommonControls
  !insertmacro SimpleMusicTintCommonControlsBody
FunctionEnd

!include "${PROJECT_DIR}\build\windows-directory.nsh"

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

Function SimpleMusicDirectoryBrowse
  Pop $0
  ${NSD_GetText} $SimpleMusicDirectoryInput $0
  nsDialogs::SelectFolderDialog "选择安装位置（自动创建 Simple Music 文件夹）" "$0"
  Pop $0
  ${If} $0 != error
  ${AndIf} $0 != ""
    SendMessage $SimpleMusicDirectoryInput ${WM_SETTEXT} 0 "STR:$0"
  ${EndIf}
FunctionEnd

; 回调必须弹出控件句柄；预览不创建目录、不改写注册表。
Function SimpleMusicDirectoryChanged
  Pop $0
  Call SimpleMusicUpdateDirectoryPreview
FunctionEnd

Function SimpleMusicUpdateDirectoryPreview
  StrCpy $SimpleMusicDirectoryConfirmed ""
  ${NSD_GetText} $SimpleMusicDirectoryInput $0
  Push "$0"
  Call SimpleMusicNormalizeInstallDir
  Pop $0
  ${If} ${Errors}
    StrCpy $SimpleMusicDirectoryValid "0"
    SendMessage $SimpleMusicDirectoryPreview ${WM_SETTEXT} 0 "STR:请输入有效的安装位置"
    SendMessage $SimpleMusicDirectoryStatus ${WM_SETTEXT} 0 "STR:请选择磁盘中的独立文件夹，不能使用系统目录。"
    SetCtlColors $SimpleMusicDirectoryStatus "B42318" "FFFFFF"
  ${Else}
    StrCpy $SimpleMusicDirectoryValid "1"
    ; 与真正安装使用同一套冲突避让规则，提前显示最终路径。
    Push "$INSTDIR"
    StrCpy $INSTDIR "$0"
    Call SimpleMusicResolveInstallDirectory
    ${If} ${Errors}
      Pop $INSTDIR
      StrCpy $SimpleMusicDirectoryValid "0"
      SendMessage $SimpleMusicDirectoryPreview ${WM_SETTEXT} 0 "STR:此位置的安装目录已被占用"
      SendMessage $SimpleMusicDirectoryStatus ${WM_SETTEXT} 0 "STR:请更换安装位置。已有文件会保留。"
      SetCtlColors $SimpleMusicDirectoryStatus "B42318" "FFFFFF"
      GetDlgItem $0 $HWNDPARENT 1
      EnableWindow $0 0
      Return
    ${EndIf}
    SendMessage $SimpleMusicDirectoryPreview ${WM_SETTEXT} 0 "STR:$INSTDIR"
    StrCpy $SimpleMusicDirectoryConfirmed "$INSTDIR"
    ReadINIStr $0 "$INSTDIR\.simple-music-install.ini" "application" "id"
    ${If} $0 == "com.simplemusic.desktop"
      SendMessage $SimpleMusicDirectoryStatus ${WM_SETTEXT} 0 "STR:将在此位置更新程序，保留设置和音乐文件。"
    ${Else}
      SendMessage $SimpleMusicDirectoryStatus ${WM_SETTEXT} 0 "STR:自动创建所需文件夹，保留已有文件。"
    ${EndIf}
    Pop $INSTDIR
    SetCtlColors $SimpleMusicDirectoryStatus "4B5263" "FFFFFF"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1
  EnableWindow $0 $SimpleMusicDirectoryValid
FunctionEnd

Function SimpleMusicDirectoryShow
  !insertmacro MUI_HEADER_TEXT "安装 Simple Music" "版本 ${VERSION}"
  nsDialogs::Create 1018
  Pop $SimpleMusicDirectoryPage
  ${If} $SimpleMusicDirectoryPage == error
    Abort
  ${EndIf}

  SetCtlColors $SimpleMusicDirectoryPage "111217" "FFFFFF"
  ; 字体在 GUI 初始化时创建，返回本页不重复分配 GDI 资源。

  ${NSD_CreateLabel} 14u 4u 268u 18u "安装位置"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $SimpleMusicTitleFont 1
  SetCtlColors $0 "111217" "FFFFFF"

  ${NSD_CreateLabel} 14u 28u 268u 20u "选择磁盘或文件夹，程序会放入 Simple Music 子文件夹。"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $SimpleMusicBodyFont 1
  SetCtlColors $0 "4B5263" "FFFFFF"

  ${NSD_CreateText} 14u 52u 210u 16u "$INSTDIR"
  Pop $SimpleMusicDirectoryInput
  SendMessage $SimpleMusicDirectoryInput ${WM_SETFONT} $SimpleMusicBodyFont 1
  SetCtlColors $SimpleMusicDirectoryInput "111217" "FFFFFF"

  ${NSD_OnChange} $SimpleMusicDirectoryInput SimpleMusicDirectoryChanged

  ${NSD_CreateBrowseButton} 232u 51u 54u 18u "更改…"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $SimpleMusicSmallFont 1
  ${NSD_OnClick} $0 SimpleMusicDirectoryBrowse

  ${NSD_CreateLabel} 14u 78u 268u 10u "实际安装到"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $SimpleMusicSmallFont 1
  SetCtlColors $0 "6B7280" "FFFFFF"

  nsDialogs::CreateControl EDIT ${WS_VISIBLE}|${WS_CHILD}|${WS_TABSTOP}|${ES_READONLY}|${ES_MULTILINE}|${ES_AUTOVSCROLL} ${WS_EX_CLIENTEDGE} 14u 92u 272u 24u ""
  Pop $SimpleMusicDirectoryPreview
  SendMessage $SimpleMusicDirectoryPreview ${WM_SETFONT} $SimpleMusicBodyFont 1
  SetCtlColors $SimpleMusicDirectoryPreview "245782" "F1F6FA"

  ${NSD_CreateLabel} 14u 122u 272u 18u ""
  Pop $SimpleMusicDirectoryStatus
  SendMessage $SimpleMusicDirectoryStatus ${WM_SETFONT} $SimpleMusicSmallFont 1
  Call SimpleMusicUpdateDirectoryPreview
  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:安装"
  GetDlgItem $0 $HWNDPARENT 3
  EnableWindow $0 0
  nsDialogs::Show
FunctionEnd

Function SimpleMusicDirectoryLeave
  ; 点击前重新计算，目录若被其它进程占用，须再次确认新位置。
  StrCpy $SimpleMusicDirectoryLastPreview "$SimpleMusicDirectoryConfirmed"
  Call SimpleMusicUpdateDirectoryPreview
  ${If} $SimpleMusicDirectoryValid != "1"
    Abort
  ${EndIf}
  ${If} $SimpleMusicDirectoryLastPreview != $SimpleMusicDirectoryConfirmed
    Abort
  ${EndIf}
  StrCpy $INSTDIR "$SimpleMusicDirectoryConfirmed"
  Call SimpleMusicSelectInstallDirectory
  ${If} $INSTDIR != $SimpleMusicDirectoryConfirmed
    Call SimpleMusicUpdateDirectoryPreview
    Abort
  ${EndIf}
FunctionEnd

!else

Function un.SimpleMusicGuiInit
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 20, *i 0, i 4) i .r0'
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 19, *i 0, i 4) i .r0'
  Call un.SimpleMusicTintCommonControls
FunctionEnd

Function un.SimpleMusicTintCommonControls
  !insertmacro SimpleMusicTintCommonControlsBody
FunctionEnd

Function un.SimpleMusicUnWelcomeShow
  !insertmacro MUI_HEADER_TEXT "卸载 Simple Music" "确认要移除的程序和位置。"
  nsDialogs::Create 1018
  Pop $SimpleMusicUnWelcomePage
  ${If} $SimpleMusicUnWelcomePage == error
    Abort
  ${EndIf}

  SetCtlColors $SimpleMusicUnWelcomePage "111217" "FFFFFF"
  CreateFont $SimpleMusicTitleFont "Microsoft YaHei UI" 13 600
  CreateFont $SimpleMusicBodyFont "Microsoft YaHei UI" 9 400
  CreateFont $SimpleMusicSmallFont "Microsoft YaHei UI" 9 400

  ${NSD_CreateLabel} 14u 4u 272u 18u "移除程序"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $SimpleMusicTitleFont 1
  SetCtlColors $0 "111217" "FFFFFF"

  ${NSD_CreateLabel} 14u 28u 272u 28u "卸载程序和快捷方式。你放入安装目录的其它文件会保留。"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $SimpleMusicBodyFont 1
  SetCtlColors $0 "4B5263" "FFFFFF"

  ${NSD_CreateLabel} 14u 64u 272u 12u "程序所在位置"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $SimpleMusicSmallFont 1
  SetCtlColors $0 "6B7280" "FFFFFF"

  nsDialogs::CreateControl EDIT ${WS_VISIBLE}|${WS_CHILD}|${WS_TABSTOP}|${ES_READONLY}|${ES_MULTILINE}|${ES_AUTOVSCROLL} ${WS_EX_CLIENTEDGE} 14u 80u 272u 32u "$INSTDIR"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $SimpleMusicBodyFont 1
  SetCtlColors $0 "245782" "F1F6FA"

  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "--delete-app-data" $1
  ${If} ${Errors}
    StrCpy $1 "保留设置、登录状态和播放器数据，方便以后重新安装。"
  ${Else}
    StrCpy $1 "此次卸载还会删除播放器数据，包括设置和登录状态。"
  ${EndIf}
  ${NSD_CreateLabel} 14u 120u 272u 22u "$1"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $SimpleMusicSmallFont 1
  SetCtlColors $0 "4B5263" "FFFFFF"

  nsDialogs::Show
FunctionEnd

!endif
