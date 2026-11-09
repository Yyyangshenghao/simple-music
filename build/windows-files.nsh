!macro SimpleMusicPathFunctions PREFIX
Function ${PREFIX}SimpleMusicCheckPath
  Exch $0
  Push $1
  Push $2
  StrCpy $1 "$0"
simple_music_check_path_loop:
  System::Call 'kernel32::GetFileAttributesW(w r1) i .r2'
  ${If} $2 != -1
    IntOp $2 $2 & 0x400
    ${If} $2 != 0
      Pop $2
      Pop $1
      Pop $0
      SetErrorLevel 2
      Abort "安装路径包含目录链接，已停止操作。"
    ${EndIf}
  ${EndIf}
  ${GetParent} "$1" $2
  ${If} $2 != ""
  ${AndIf} $2 != $1
    StrCpy $1 "$2"
    Goto simple_music_check_path_loop
  ${EndIf}
  Pop $2
  Pop $1
  Pop $0
FunctionEnd
!macroend

!macro SimpleMusicCheckPath PREFIX TARGET
  Push "${TARGET}"
  Call ${PREFIX}SimpleMusicCheckPath
!macroend

!macro SimpleMusicCheckFile PREFIX TARGET
  !insertmacro SimpleMusicCheckPath "${PREFIX}" "${TARGET}"
  Push $0
  System::Call 'kernel32::GetFileAttributesW(w "${TARGET}") i .r0'
  ${If} $0 != -1
    IntOp $0 $0 & 0x10
    ${If} $0 != 0
      Pop $0
      SetErrorLevel 2
      Abort "预期程序文件的位置已变成目录，已停止操作。"
    ${EndIf}
  ${EndIf}
  Pop $0
!macroend
