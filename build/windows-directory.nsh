!macro SimpleMusicDirectoryFunctions
Function SimpleMusicNormalizeInstallDir
  Exch $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  StrCpy $5 "0"

  ; 接受从资源管理器或地址栏粘贴的正斜杠路径，例如 D:/。
  StrCpy $1 0
simple_music_normalize_slashes:
  StrCpy $2 "$0" 1 $1
  ${If} $2 == ""
    Goto simple_music_slashes_done
  ${EndIf}
  ${If} $2 == "/"
    StrCpy $2 "$0" $1
    IntOp $3 $1 + 1
    StrCpy $4 "$0" "" $3
    StrCpy $0 "$2\$4"
  ${EndIf}
  IntOp $1 $1 + 1
  Goto simple_music_normalize_slashes
simple_music_slashes_done:

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
  ; 已管理的安装沿用原位置；新安装总是在独立的品牌目录内。
  ReadINIStr $1 "$0\.simple-music-install.ini" "application" "id"
  ${If} $1 == "com.simplemusic.desktop"
    Goto simple_music_directory_done
  ${EndIf}
  ; 无清单的已登记旧版交给迁移逻辑处理，不把旧目录误认成父目录。
  ReadRegStr $1 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $1 == $0
    Goto simple_music_directory_done
  ${EndIf}
  ${GetFileName} "$0" $1
  StrCpy $2 "$1" 13
  ${If} $1 != "Simple Music"
  ${AndIf} $2 != "Simple Music-"
    StrCpy $0 "$0\Simple Music"
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
!macroend

