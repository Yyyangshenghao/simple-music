!include LogicLib.nsh
!include FileFunc.nsh
!include WinMessages.nsh
!include MUI2.nsh
!include "${PROJECT_DIR}\build\windows-files.nsh"
!include "${PROJECT_DIR}\build\windows-processes.nsh"

!ifdef BUILD_UNINSTALLER
  !include "${PROJECT_DIR}\dist\nsis-safe\remove-files.nsh"
  Var SimpleMusicUninstallDataNote
!else
  !include "${PROJECT_DIR}\dist\nsis-safe\install-files.nsh"
  !include "${PROJECT_DIR}\build\windows-directory.nsh"
  !define MUI_CUSTOMFUNCTION_ABORT SimpleMusicAbort
  Var SimpleMusicDirectoryBeforeConfirm
!endif

; 仅扩展文件归属与失败恢复；页面、字体、配色和按钮使用 NSIS 默认实现。
!macro customHeader
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

!macro customInit
  !ifndef BUILD_UNINSTALLER
    Call SimpleMusicSelectInstallDirectory
  !endif
!macroend

; 使用标准目录页，并在离开页面时验证最终路径。
; 配置关闭打包器自动插入的目录页，避免出现两次。
!macro customPageAfterChangeDir
  !define MUI_PAGE_CUSTOMFUNCTION_PRE SimpleMusicSelectInstallDirectory
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE SimpleMusicDirectoryLeave
  !insertmacro MUI_PAGE_DIRECTORY
!macroend

!macro customUnWelcomePage
  !define MUI_PAGE_CUSTOMFUNCTION_PRE un.SimpleMusicUninstallWelcome
  !define MUI_WELCOMEPAGE_TEXT "卸载 Simple Music 程序和快捷方式。安装目录中的额外文件会保留。$\r$\n$\r$\n$SimpleMusicUninstallDataNote"
  !insertmacro MUI_UNPAGE_WELCOME
!macroend

!macro customUnInstall
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

; 安装段在任何写入或旧版处理之前再次调用，覆盖静默安装及页面重置路径。
!macro SimpleMusicValidateInstallDirectory
  Call SimpleMusicValidateInstallDirectory
!macroend

!ifndef BUILD_UNINSTALLER

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

Function SimpleMusicDirectoryLeave
  StrCpy $SimpleMusicDirectoryBeforeConfirm "$INSTDIR"
  Call SimpleMusicSelectInstallDirectory
  ${If} $SimpleMusicDirectoryBeforeConfirm != $INSTDIR
    ; 盘符补子目录、旧版迁移或目录冲突改变目标后，留在原生页面再次确认。
    SendMessage $mui.DirectoryPage.Directory ${WM_SETTEXT} 0 "STR:$INSTDIR"
    MessageBox MB_ICONINFORMATION|MB_OK "安装位置已调整为：$\r$\n$INSTDIR$\r$\n$\r$\n请确认后再点击安装。" /SD IDOK
    Abort
  ${EndIf}
FunctionEnd

!else

Function un.SimpleMusicUninstallWelcome
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "--delete-app-data" $1
  ${If} ${Errors}
    StrCpy $SimpleMusicUninstallDataNote "保留设置、登录状态和播放器数据。"
  ${Else}
    StrCpy $SimpleMusicUninstallDataNote "此次卸载还会删除播放器数据，包括设置和登录状态。"
  ${EndIf}
FunctionEnd

!endif
