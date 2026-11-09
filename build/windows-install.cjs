const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const MANIFEST = '.simple-music-install.ini'
const appId = 'com.simplemusic.desktop'
const keyFor = name => crypto.createHash('sha256').update(name).digest('hex')
const win = name => name.replace(/\$/g, '$$$$').replaceAll('/', '\\')

function hashFile(file) {
  const hash = crypto.createHash('sha256')
  const fd = fs.openSync(file, 'r')
  const buffer = Buffer.alloc(1024 * 1024)
  try {
    let length
    while ((length = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, length))
    return hash.digest('hex')
  } finally { fs.closeSync(fd) }
}

function installScripts(files, root) {
  const records = files.map(name => ({ name, hash: hashFile(path.join(root, name)), key: keyFor(name) }))
  const packageId = keyFor(JSON.stringify(records))
  const names = [...files.map(win), '${UNINSTALL_FILENAME}', 'uninstallerIcon.ico', MANIFEST]
  const ownedKeys = new Map(files.map(name => [win(name), keyFor(name)]))
  const written = name => `SimpleMusicWritten_${keyFor(name).slice(0, 12)}`
  const links = ['$oldStartMenuLink', '$newStartMenuLink', '$oldDesktopLink', '$newDesktopLink']
  const registry = [
    ...['InstallLocation', 'KeepShortcuts', 'ShortcutName', 'MenuDirectory'].map(name => ['${INSTALL_REGISTRY_KEY}', name, 'Str']),
    ...['DisplayName', 'UninstallString', 'QuietUninstallString', 'DisplayVersion', 'DisplayIcon', 'Publisher', 'Comments', 'HelpLink', 'URLInfoAbout', 'URLUpdateInfo', 'Readme'].map(name => ['${UNINSTALL_REGISTRY_KEY}', name, 'Str']),
    ...['NoModify', 'NoRepair', 'EstimatedSize'].map(name => ['${UNINSTALL_REGISTRY_KEY}', name, 'DWORD'])
  ]
  const manifest = ['[application]', `id=${appId}`, `package=${packageId}`, '[files]',
    ...files.map(name => `${keyFor(name)}=${name.replaceAll('/', '\\')}`),
    `${keyFor('${UNINSTALL_FILENAME}')}=\${UNINSTALL_FILENAME}`, ''].join('\r\n')
  const lines = [
    '!macro SimpleMusicInstallFunctions',
    'Var SimpleMusicTargetDir', 'Var SimpleMusicStageDir', 'Var SimpleMusicBackupDir',
    'Var SimpleMusicTransactionActive', 'Var SimpleMusicLegacyDir',
    'Var SimpleMusicLegacyOriginal', 'Var SimpleMusicLegacyReplaced',
    ...links.map((_, index) => `Var SimpleMusicLinkExists${index}`),
    ...names.map(name => `Var ${written(name)}`),
    ...registry.flatMap((_, index) => [`Var SimpleMusicReg${index}`, `Var SimpleMusicRegExists${index}`]),
    'Function SimpleMusicSelectInstallDirectory',
    '  Call SimpleMusicValidateInstallDirectory',
    '  !insertmacro SimpleMusicCheckPath "" "$INSTDIR"',
    '  Call SimpleMusicResolveInstallDirectory',
    '  ${If} ${Errors}', '    SetErrorLevel 2', '    Abort "无法选择独立的空安装目录。"', '  ${EndIf}',
    '  Call SimpleMusicValidateInstallDirectory',
    '  !insertmacro SimpleMusicCheckPath "" "$INSTDIR"',
    // 页面预览可以重复解析，旧版迁移状态只能在确认最终目录后重建。
    '  StrCpy $SimpleMusicLegacyDir ""',
    '  ReadRegStr $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation',
    '  ${If} $0 != ""',
    `    ReadINIStr $1 "$0\\${MANIFEST}" "application" "id"`,
    `    \${If} $1 != "${appId}"`,
    '      Push "$0"', '      Call SimpleMusicNormalizeInstallDir', '      Pop $1',
    '      ${IfNot} ${Errors}', '      ${AndIf} $0 == $1',
    '        StrCpy $1 "$INSTDIR"',
    'simple_music_find_legacy_parent:',
    '        ${If} $1 == $0', '          StrCpy $SimpleMusicLegacyDir "$0"',
    '        ${Else}', '          ${GetParent} "$1" $2',
    '          ${If} $2 != ""', '          ${AndIf} $2 != $1',
    '            StrCpy $1 "$2"', '            Goto simple_music_find_legacy_parent',
    '          ${EndIf}', '        ${EndIf}', '      ${EndIf}', '    ${EndIf}', '  ${EndIf}',
    '  ClearErrors',
    'FunctionEnd',
    'Function SimpleMusicResolveInstallDirectory',
    `  ReadINIStr $0 "$INSTDIR\\${MANIFEST}" "application" "id"`,
    `  \${If} $0 == "${appId}"`, '    ClearErrors', '    Return', '  ${EndIf}',
    '  FindFirst $0 $1 "$INSTDIR\\*"',
    'simple_music_find_existing:',
    '  ${If} $1 == "."', '  ${OrIf} $1 == ".."', '    FindNext $0 $1', '    Goto simple_music_find_existing', '  ${EndIf}',
    '  FindClose $0',
    '  ${If} $1 == ""', '    ClearErrors', '    Return', '  ${EndIf}',
    // 无所有权清单的旧版/混用目录不覆盖、不卸载，迁移到空的应用子目录。
    '  StrCpy $2 "$INSTDIR\\Simple Music"', '  StrCpy $3 0',
    'simple_music_choose_empty:',
    '  StrCpy $INSTDIR "$2"',
    '  ${If} $3 != 0', '    StrCpy $INSTDIR "$2-$3"', '  ${EndIf}',
    '  System::Call \'kernel32::GetFileAttributesW(w "$INSTDIR") i .r0\'',
    '  ${If} $0 != -1', '    IntOp $3 $3 + 1',
    '    ${If} $3 > 100', '      SetErrors', '      Return', '    ${EndIf}',
    '    Goto simple_music_choose_empty', '  ${EndIf}',
    '  ClearErrors',
    'FunctionEnd',
    'Function SimpleMusicPreflightFiles',
    '  Call SimpleMusicSelectInstallDirectory'
  ]
  for (const name of names) {
    if (name === 'uninstallerIcon.ico') lines.push('  !ifdef UNINSTALLER_ICON')
    lines.push(`  !insertmacro SimpleMusicCheckFile "" "$INSTDIR\\${name}"`)
    if (name !== MANIFEST) {
      const key = ownedKeys.get(name) || keyFor(name)
      lines.push(`  \${If} \${FileExists} "$INSTDIR\\${name}"`,
        `    ReadINIStr $0 "$INSTDIR\\${MANIFEST}" "files" "${key}"`,
        `    \${If} $0 != "${name}"`,
        '      SetErrorLevel 2', `      Abort '安装目录有不属于本应用的同名文件：${name}'`,
        '    ${EndIf}', '  ${EndIf}')
    }
    if (name === 'uninstallerIcon.ico') lines.push('  !endif')
  }
  lines.push('FunctionEnd',
    'Function SimpleMusicBeginTransaction',
    ...names.map(name => `  StrCpy $${written(name)} "0"`),
    ...registry.flatMap(([key, name, type], index) => [
      '  ClearErrors', `  ReadReg${type} $SimpleMusicReg${index} SHELL_CONTEXT "${key}" "${name}"`,
      `  StrCpy $SimpleMusicRegExists${index} "1"`,
      '  ${If} ${Errors}', `    StrCpy $SimpleMusicRegExists${index} "0"`, '  ${EndIf}'
    ]),
    '  StrCpy $SimpleMusicTargetDir "$INSTDIR"',
    '  CreateDirectory "$INSTDIR"',
    '  ClearErrors',
    '  GetTempFileName $SimpleMusicStageDir "$INSTDIR"',
    '  ${If} ${Errors}', '    Abort "无法创建安装暂存目录。"', '  ${EndIf}',
    '  Delete "$SimpleMusicStageDir"', '  CreateDirectory "$SimpleMusicStageDir"',
    '  GetTempFileName $SimpleMusicBackupDir "$INSTDIR"',
    '  ${If} ${Errors}', '    Abort "无法创建安装备份目录。"', '  ${EndIf}',
    '  Delete "$SimpleMusicBackupDir"', '  CreateDirectory "$SimpleMusicBackupDir"',
    '  ${If} ${Errors}', '    Abort "无法创建安装暂存与备份目录。"', '  ${EndIf}',
    ...links.flatMap((link, index) => [
      `  StrCpy $SimpleMusicLinkExists${index} "0"`,
      `  \${If} \${FileExists} "${link}"`,
      '    ClearErrors', `    CopyFiles /SILENT "${link}" "$SimpleMusicBackupDir\\link${index}.lnk"`,
      '    ${If} ${Errors}', '      Abort "无法备份应用快捷方式。"', '    ${EndIf}',
      `    StrCpy $SimpleMusicLinkExists${index} "1"`, '  ${EndIf}'
    ]),
    '  StrCpy $SimpleMusicLegacyOriginal "0"', '  StrCpy $SimpleMusicLegacyReplaced "0"',
    '  ${If} $SimpleMusicLegacyDir != ""',
    '    !insertmacro SimpleMusicCheckPath "" "$SimpleMusicLegacyDir\\${UNINSTALL_FILENAME}"',
    '    ${If} ${FileExists} "$SimpleMusicLegacyDir\\${UNINSTALL_FILENAME}"',
    '      ClearErrors',
    '      CopyFiles /SILENT "$SimpleMusicLegacyDir\\${UNINSTALL_FILENAME}" "$SimpleMusicBackupDir\\legacy-uninstaller.exe"',
    '      ${If} ${Errors}', '        Abort "无法备份旧版卸载器。"', '      ${EndIf}',
    '      StrCpy $SimpleMusicLegacyOriginal "1"', '    ${EndIf}', '  ${EndIf}',
    '  StrCpy $SimpleMusicTransactionActive "1"',
    '  StrCpy $INSTDIR "$SimpleMusicStageDir"',
    '  SetOutPath "$INSTDIR"',
    'FunctionEnd',
    'Function SimpleMusicCommitFiles',
    '  StrCpy $INSTDIR "$SimpleMusicTargetDir"',
    '  SetOutPath $TEMP')
  // 先完整校验解压结果，再移动旧文件；损坏包/空间不足不会先删除旧版。
  for (const { name, hash } of records) {
    lines.push(`  \${StdUtils.HashFile} $0 "SHA2-256" "$SimpleMusicStageDir\\${win(name)}"`,
      `  \${If} $0 != "${hash}"`, '    Call SimpleMusicRollbackFiles',
      '    SetErrorLevel 2', '    Abort "安装文件校验失败，旧版本已保留。"', '  ${EndIf}')
  }
  lines.push(`  File /oname=$SimpleMusicStageDir\\${MANIFEST} "\${PROJECT_DIR}\\dist\\nsis-safe\\install-manifest.ini"`)
  // INI 中的卸载器名需在编译时展开，而非保留生成文本里的 ${...}。
  lines.push('  ClearErrors',
    `  WriteINIStr "$SimpleMusicStageDir\\${MANIFEST}" "files" "${keyFor('${UNINSTALL_FILENAME}')}" "\${UNINSTALL_FILENAME}"`,
    '  !ifdef UNINSTALLER_ICON',
    `    WriteINIStr "$SimpleMusicStageDir\\${MANIFEST}" "files" "${keyFor('uninstallerIcon.ico')}" "uninstallerIcon.ico"`,
    '  !endif',
    '  ${If} ${Errors}', '    Call SimpleMusicRollbackFiles', '    SetErrorLevel 2',
    '    Abort "无法写入文件归属清单，旧版本已保留。"', '  ${EndIf}',
    '  ${IfNot} ${FileExists} "$SimpleMusicStageDir\\${UNINSTALL_FILENAME}"',
    '    Call SimpleMusicRollbackFiles', '    SetErrorLevel 2',
    '    Abort "安装包缺少卸载器，旧版本已保留。"', '  ${EndIf}')
  for (const name of names) {
    if (name === 'uninstallerIcon.ico') lines.push('  !ifdef UNINSTALLER_ICON')
    const parent = path.win32.dirname(name)
    lines.push(`  !insertmacro SimpleMusicCheckFile "" "$INSTDIR\\${name}"`,
      `  \${If} \${FileExists} "$INSTDIR\\${name}"`,
      `    CreateDirectory "$SimpleMusicBackupDir\\${parent}"`, '    ClearErrors',
      `    Rename "$INSTDIR\\${name}" "$SimpleMusicBackupDir\\${name}"`,
      '    IfErrors simple_music_install_failed', '  ${EndIf}')
    if (name === 'uninstallerIcon.ico') lines.push('  !endif')
  }
  for (const name of names) {
    if (name === 'uninstallerIcon.ico') lines.push('  !ifdef UNINSTALLER_ICON')
    const parent = path.win32.dirname(name)
    lines.push(`  \${If} \${FileExists} "$SimpleMusicStageDir\\${name}"`,
      `    CreateDirectory "$INSTDIR\\${parent}"`, '    ClearErrors',
      `    Rename "$SimpleMusicStageDir\\${name}" "$INSTDIR\\${name}"`,
      '    IfErrors simple_music_install_failed', `    StrCpy $${written(name)} "1"`, '  ${EndIf}')
    if (name === 'uninstallerIcon.ico') lines.push('  !endif')
  }
  lines.push('  Return', 'simple_music_install_failed:', '  Call SimpleMusicRollbackFiles',
    '  SetErrorLevel 2', '  Abort "无法写入安装文件，安装已取消。"', 'FunctionEnd',
    'Function SimpleMusicRollbackFiles',
    '  ${If} $SimpleMusicTransactionActive != "1"', '    Return', '  ${EndIf}',
    '  StrCpy $INSTDIR "$SimpleMusicTargetDir"')
  for (const name of names) {
    lines.push(`  \${If} $${written(name)} == "1"`,
      `    Delete "$INSTDIR\\${name}"`,
      '  ${EndIf}',
      `  \${If} \${FileExists} "$SimpleMusicBackupDir\\${name}"`,
      '    ClearErrors',
      `    Rename "$SimpleMusicBackupDir\\${name}" "$INSTDIR\\${name}"`,
      '    ${If} ${Errors}',
      '      DetailPrint "无法恢复部分文件，备份保留在 $SimpleMusicBackupDir"',
      '    ${EndIf}', '  ${EndIf}')
  }
  for (const [index, [key, name, type]] of registry.entries()) {
    lines.push(`  \${If} $SimpleMusicRegExists${index} == "1"`,
      `    WriteReg${type} SHELL_CONTEXT "${key}" "${name}" $SimpleMusicReg${index}`,
      '  ${Else}', `    DeleteRegValue SHELL_CONTEXT "${key}" "${name}"`, '  ${EndIf}')
  }
  // 此版本 NSIS 的 /ifempty 只看子键不看值，直接调用会连刚恢复的值一起删掉，须先确认键里没有值。
  for (const key of ['${INSTALL_REGISTRY_KEY}', '${UNINSTALL_REGISTRY_KEY}']) {
    lines.push(`  EnumRegValue $0 SHELL_CONTEXT "${key}" 0`,
      '  ${If} $0 == ""', `    DeleteRegKey /ifempty SHELL_CONTEXT "${key}"`, '  ${EndIf}')
  }
  lines.push('  ClearErrors')
  for (const [index, link] of links.entries()) {
    lines.push(`  \${If} $SimpleMusicLinkExists${index} == "1"`,
      `    \${GetParent} "${link}" $0`, '    CreateDirectory "$0"', '    ClearErrors',
      `    CopyFiles /SILENT "$SimpleMusicBackupDir\\link${index}.lnk" "${link}"`,
      '    ${If} ${Errors}', '      DetailPrint "无法恢复部分快捷方式，备份保留在 $SimpleMusicBackupDir"', '    ${EndIf}',
      '  ${Else}', `    Delete "${link}"`, '  ${EndIf}')
  }
  lines.push('  ${If} $SimpleMusicLegacyReplaced == "1"',
    '    ${If} $SimpleMusicLegacyOriginal == "1"',
    '      CopyFiles /SILENT "$SimpleMusicBackupDir\\legacy-uninstaller.exe" "$SimpleMusicLegacyDir\\${UNINSTALL_FILENAME}"',
    '    ${Else}', '      Delete "$SimpleMusicLegacyDir\\${UNINSTALL_FILENAME}"', '    ${EndIf}', '  ${EndIf}')
  // 失败时不递归删除备份，无法恢复的文件仍可人工取回。
  lines.push('  StrCpy $SimpleMusicTransactionActive "0"', 'FunctionEnd',
    'Function SimpleMusicFinishTransaction',
    // 保留无清单目录的内容，并同步登记过的卸载入口。
    '  ${If} $SimpleMusicLegacyDir != ""',
    '    !insertmacro SimpleMusicCheckPath "" "$SimpleMusicLegacyDir\\${UNINSTALL_FILENAME}"',
    '    StrCpy $SimpleMusicLegacyReplaced "1"',
    '    ClearErrors',
    '    CopyFiles /SILENT "$INSTDIR\\${UNINSTALL_FILENAME}" "$SimpleMusicLegacyDir\\${UNINSTALL_FILENAME}"',
    '    ${If} ${Errors}',
    '      Call SimpleMusicRollbackFiles', '      SetErrorLevel 2',
    '      Abort "无法替换旧版卸载器，安装已取消。"', '    ${EndIf}', '  ${EndIf}',
    '  StrCpy $SimpleMusicTransactionActive "0"')
  const dirs = new Set()
  for (const file of files) {
    let parent = path.posix.dirname(file)
    while (parent !== '.') { dirs.add(parent); parent = path.posix.dirname(parent) }
  }
  for (const base of ['$SimpleMusicStageDir', '$SimpleMusicBackupDir']) {
    for (const name of names) lines.push(`  Delete "${base}\\${name}"`)
    for (const name of ['legacy-uninstaller.exe', ...links.map((_, index) => `link${index}.lnk`)]) {
      lines.push(`  Delete "${base}\\${name}"`)
    }
    for (const dir of [...dirs].sort((a, b) => b.split('/').length - a.split('/').length)) {
      lines.push(`  RMDir "${base}\\${win(dir)}"`)
    }
    lines.push(`  RMDir "${base}"`)
  }
  lines.push('  ClearErrors', 'FunctionEnd',
    'Function .onInstFailed', '  Call SimpleMusicRollbackFiles', '  SetErrorLevel 2', 'FunctionEnd',
    'Function SimpleMusicAbort', '  Call SimpleMusicRollbackFiles', '  SetErrorLevel 1', 'FunctionEnd',
    '!macroend', '')
  return { script: lines.join('\n'), manifest, packageId, names }
}

module.exports = { installScripts, MANIFEST, keyFor }
