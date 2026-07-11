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
!endif

!include LogicLib.nsh
!include FileFunc.nsh
!include nsDialogs.nsh
!include WinMessages.nsh

!ifndef BUILD_UNINSTALLER
  Var SimpleMusicWelcomePage
  Var SimpleMusicHeroFont
  Var SimpleMusicTitleFont
  Var SimpleMusicBodyFont
  Var SimpleMusicSmallFont
  Var SimpleMusicDirectoryPage
  Var SimpleMusicDirectoryInput
!endif

!macro customInit
  !ifndef BUILD_UNINSTALLER
    Call SimpleMusicUsePreferredInstallDir
  !endif
!macroend

!macro customWelcomePage
  Page custom SimpleMusicWelcomeShow
!macroend

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
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
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW SimpleMusicTintCommonControls
  !insertmacro MUI_PAGE_FINISH
!macroend

!ifndef BUILD_UNINSTALLER
Function SimpleMusicGuiInit
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 20, *i 1, i 4) i .r0'
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 19, *i 1, i 4) i .r0'
  Call SimpleMusicTintCommonControls
FunctionEnd

Function SimpleMusicTintCommonControls
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
FunctionEnd

Function SimpleMusicUsePreferredInstallDir
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/D=" $R1
  ${IfNot} ${Errors}
  ${AndIf} $R1 != ""
    StrCpy $INSTDIR "$R1"
  ${Else}
    IfFileExists "D:\*.*" 0 +2
    StrCpy $INSTDIR "D:\SimpleMusic"
  ${EndIf}
FunctionEnd

Function SimpleMusicNormalizeInstallDir
  Exch $0
  StrLen $1 "$0"
  ${If} $1 == 2
    StrCpy $2 "$0" 1 1
    ${If} $2 == ":"
      StrCpy $0 "$0\SimpleMusic"
    ${EndIf}
  ${ElseIf} $1 == 3
    StrCpy $2 "$0" 1 1
    StrCpy $3 "$0" 1 2
    ${If} $2 == ":"
    ${AndIf} $3 == "\"
      StrCpy $0 "$0SimpleMusic"
    ${EndIf}
  ${EndIf}
  Exch $0
FunctionEnd

Function SimpleMusicWelcomeShow
  Call SimpleMusicUsePreferredInstallDir

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

  ${NSD_CreateLabel} 22u 96u 238u 24u "为这台电脑安装 Simple Music。默认安装到 D:\SimpleMusic，下一步可以自由选择其它位置。"
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
  Call SimpleMusicUsePreferredInstallDir

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

  ${NSD_CreateLabel} 22u 122u 238u 12u "默认推荐：D:\SimpleMusic；选盘符会自动建文件夹。"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $SimpleMusicSmallFont 1
  SetCtlColors $0 "6B7280" "FFFFFF"

  nsDialogs::Show
FunctionEnd

Function SimpleMusicDirectoryLeave
  ${NSD_GetText} $SimpleMusicDirectoryInput $0
  ${If} $0 == ""
    MessageBox MB_ICONEXCLAMATION|MB_OK "请选择安装文件夹。"
    Abort
  ${EndIf}
  Push "$0"
  Call SimpleMusicNormalizeInstallDir
  Pop $0
  StrCpy $INSTDIR "$0"
  SendMessage $SimpleMusicDirectoryInput ${WM_SETTEXT} 0 "STR:$INSTDIR"
FunctionEnd
!endif
