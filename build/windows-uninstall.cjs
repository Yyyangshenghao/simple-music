const fs = require('node:fs')
const path = require('node:path')
const { installScripts, MANIFEST } = require('./windows-install.cjs')

// 只信任构建产物中的相对文件名，不扫描用户的安装目录推断文件归属。
function packageFiles(root, prefix = '') {
  return fs.readdirSync(path.join(root, prefix), { withFileTypes: true }).flatMap(entry => {
    const name = path.posix.join(prefix, entry.name)
    if (entry.isSymbolicLink() || /[\\:*?'"`<>|\r\n]/.test(name) || name.includes('${')) {
      throw new Error(`不安全的 Windows 打包路径：${name}`)
    }
    return entry.isDirectory() ? packageFiles(root, name) : [name]
  }).sort()
}

function nsisPath(name) {
  return name.replace(/\$/g, '$$$$').replaceAll('/', '\\')
}

function removalScript(files, packageId = '') {
  const names = files.map(nsisPath)
  names.push('${UNINSTALL_FILENAME}', 'uninstallerIcon.ico', MANIFEST)
  const dirs = new Set()
  for (const file of files) {
    let dir = path.posix.dirname(file)
    while (dir !== '.') {
      dirs.add(dir)
      dir = path.posix.dirname(dir)
    }
  }
  const lines = [
    '!macro customRemoveFiles',
    '  Call un.SimpleMusicRemoveFiles',
    '!macroend',
    '!macro SimpleMusicRemovalFunctions',
    'Function un.SimpleMusicRemoveFiles',
    '  SetOutPath $TEMP',
    `  ReadINIStr $0 "$INSTDIR\\${MANIFEST}" "application" "package"`,
    `  \${If} $0 != "${packageId}"`,
    '    SetErrorLevel 2',
    '    Abort "卸载器与安装目录不匹配，已停止操作。"',
    '  ${EndIf}'
  ]
  for (const name of names) {
    if (name === 'uninstallerIcon.ico') lines.push('  !ifdef UNINSTALLER_ICON')
    lines.push(
      `  !insertmacro SimpleMusicCheckFile "un." "$INSTDIR\\${name}"`,
      `  \${If} \${FileExists} "$INSTDIR\\${name}"`,
      `    System::Call 'kernel32::CreateFileW(w "$INSTDIR\\${name}", i 0x10000, i 7, p 0, i 3, i 0, p 0) p .r0'`,
      '    ${If} $0 == -1', '      SetErrorLevel 2',
      '      Abort "文件正在使用或没有删除权限，未开始卸载。"', '    ${EndIf}',
      "    System::Call 'kernel32::CloseHandle(p r0)'", '  ${EndIf}'
    )
    if (name === 'uninstallerIcon.ico') lines.push('  !endif')
  }
  for (const name of names) {
    if (name === 'uninstallerIcon.ico') lines.push('  !ifdef UNINSTALLER_ICON')
    lines.push(
      `    \${If} \${FileExists} "$INSTDIR\\${name}"`,
      '      ClearErrors',
      `      Delete "$INSTDIR\\${name}"`,
      `      \${If} \${Errors}`,
      '        SetErrorLevel 2',
      `        Abort 'Cannot remove "$INSTDIR\\${name}".'`,
      '      ${EndIf}',
      '    ${EndIf}'
    )
    if (name === 'uninstallerIcon.ico') lines.push('  !endif')
  }
  for (const dir of [...dirs].sort((a, b) => b.split('/').length - a.split('/').length)) {
    lines.push(`  RMDir "$INSTDIR\\${nsisPath(dir)}"`)
  }
  lines.push('  RMDir "$INSTDIR"', '  ClearErrors', 'FunctionEnd', '!macroend', '')
  return lines.join('\n')
}

function replaceOnce(text, before, after) {
  if (text.split(before).length !== 2) {
    throw new Error('electron-builder 的 NSIS 模板已变化，必须重新审核安全升级逻辑')
  }
  return text.replace(before, after)
}

function prepareWindowsUninstall(context) {
  if (context.electronPlatformName !== 'win32') return
  const templates = path.join(path.dirname(require.resolve('app-builder-lib/package.json')), 'templates/nsis')
  const output = path.join(context.packager.projectDir, 'dist/nsis-safe')
  fs.mkdirSync(output, { recursive: true })
  let util = fs.readFileSync(path.join(templates, 'include/installUtil.nsh'), 'utf8')
  // 不运行任何旧卸载器。旧版无清单时保留旧目录；新版由父安装器持有备份直至提交。
  const start = util.indexOf('Function uninstallOldVersion\n')
  const end = util.indexOf('FunctionEnd', start)
  if (start < 0 || end < 0) throw new Error('electron-builder 的升级入口已变化，必须重新审核')
  util = replaceOnce(util, util.slice(start, end + 'FunctionEnd'.length),
    'Function uninstallOldVersion\n  Pop $R0\n  StrCpy $R0 0\n  ClearErrors\nFunctionEnd')
  for (const name of ['GetInQuotes', 'GetFileParent']) {
    const first = util.indexOf(`Function ${name}\n`)
    const last = util.indexOf('FunctionEnd', first)
    if (first < 0 || last < 0) throw new Error('electron-builder 的安装辅助函数已变化，必须重新审核')
    util = replaceOnce(util, util.slice(first, last + 'FunctionEnd'.length), '')
  }
  let section = fs.readFileSync(path.join(templates, 'installSection.nsh'), 'utf8')
  section = replaceOnce(section, 'InitPluginsDir', 'InitPluginsDir\nCall SimpleMusicPreflightFiles')
  section = replaceOnce(section, 'SetOutPath $INSTDIR', 'Call SimpleMusicBeginTransaction\nSetOutPath $INSTDIR')
  section = replaceOnce(section, '!insertmacro installApplicationFiles',
    '!insertmacro installApplicationFiles\nCall SimpleMusicCommitFiles')
  section = replaceOnce(section, '!insertmacro registryAddInstallInfo',
    'ClearErrors\n!insertmacro registryAddInstallInfo\n${If} ${Errors}\n  Call SimpleMusicRollbackFiles\n  SetErrorLevel 2\n  Abort "无法写入安装信息，安装已取消。"\n${EndIf}')
  section = replaceOnce(section, '!ifmacrodef customInstall', 'Call SimpleMusicFinishTransaction\n\n!ifmacrodef customInstall')
  section += '\n!cd "${PROJECT_DIR}\\node_modules\\app-builder-lib\\templates\\nsis"\n'
  let extract = fs.readFileSync(path.join(templates, 'include/extractAppPackage.nsh'), 'utf8')
  extract = replaceOnce(extract,
    'MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDRETRY IDCANCEL AbortExtract7za',
    'MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDCANCEL AbortExtract7za')
  const files = packageFiles(context.appOutDir)
  const install = installScripts(files, context.appOutDir)
  fs.writeFileSync(path.join(output, 'installUtil.nsh'), util)
  fs.writeFileSync(path.join(output, 'installSection.nsh'), section)
  fs.writeFileSync(path.join(output, 'extractAppPackage.nsh'), extract)
  fs.writeFileSync(path.join(output, 'install-files.nsh'), install.script)
  fs.writeFileSync(path.join(output, 'install-manifest.ini'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(install.manifest, 'utf16le')]))
  fs.writeFileSync(path.join(output, 'remove-files.nsh'), removalScript(files, install.packageId))
}

module.exports = { packageFiles, removalScript, prepareWindowsUninstall }
