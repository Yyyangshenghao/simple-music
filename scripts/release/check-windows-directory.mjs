// 运行真实 NSIS 路径函数；只创建隔离测试文件，不安装应用、不改注册表。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

if (process.platform !== 'win32') throw new Error('路径函数验收需要 Windows')
const cache = process.env.ELECTRON_BUILDER_CACHE || path.join(process.env.LOCALAPPDATA, 'electron-builder', 'Cache')
function findCompiler(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isFile() && entry.name === 'makensis.exe' && path.basename(dir) === 'Bin') return file
    if (entry.isDirectory()) {
      const found = findCompiler(file)
      if (found) return found
    }
  }
}
const compiler = process.env.SIMPLEMUSIC_NSIS_PATH || findCompiler(cache)
assert.ok(compiler, '请先打包 Windows 安装器，以下载 NSIS 工具')
// CI 的 TEMP 可能是 8.3 短路径，安装器会展开成长路径，期望值也要用长路径。
const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'simple-music-directory-')))
const require = createRequire(import.meta.url)
const { installScripts } = require('../../build/windows-install.cjs')
fs.writeFileSync(path.join(root, 'Simple Music.exe'), 'fixture')
const resolver = installScripts(['Simple Music.exe'], root).script.match(/Function SimpleMusicResolveInstallDirectory\n[\s\S]*?FunctionEnd/)[0]
const managed = path.join(root, '旧版自定义位置')
fs.mkdirSync(managed)
fs.writeFileSync(path.join(managed, '.simple-music-install.ini'), '\ufeff[application]\r\nid=com.simplemusic.desktop\r\n', 'utf16le')
const occupied = path.join(root, '已有文件', 'Simple Music')
fs.mkdirSync(path.join(occupied, 'Simple Music'), { recursive: true })
fs.writeFileSync(path.join(occupied, '我的文件.txt'), 'keep')
const legacy = path.join(root, '旧版位置', 'Simple Music')
fs.mkdirSync(legacy, { recursive: true })
fs.writeFileSync(path.join(legacy, '我的文件.txt'), 'keep')
const cases = [
  ['D:', 'D:\\Simple Music'],
  ['D:/', 'D:\\Simple Music'],
  ['D:\\', 'D:\\Simple Music'],
  ['D:/Apps', 'D:\\Apps\\Simple Music'],
  ['D:/Apps/Simple Music/', 'D:\\Apps\\Simple Music'],
  ['D:/Apps/simple music', 'D:\\Apps\\simple music'],
  ['D:/Apps/Simple Music-2.6.2', 'D:\\Apps\\Simple Music-2.6.2'],
  [path.join(root, "O'Brien 中文"), path.join(root, "O'Brien 中文", 'Simple Music')],
  [managed, managed],
  ['', null],
  ['relative/folder', null],
  ['D:relative', null],
  ['//server/share', null],
  ['\\\\?\\D:\\Apps', null],
  ['D:/Apps/bad*name', null],
  ['D:/Apps/bad:name', null],
  [process.env.WINDIR, null],
  [path.join(process.env.WINDIR, 'Temp'), null],
  [os.homedir(), null],
  [path.join(root, '全新位置'), path.join(root, '全新位置', 'Simple Music'), true],
  [legacy, path.join(legacy, 'Simple Music'), true],
  [occupied, path.join(occupied, 'Simple Music-1'), true],
  [path.join(occupied, 'Simple Music-1'), path.join(occupied, 'Simple Music-1'), true],
  [managed, managed, true]
]
const quote = value => value.replaceAll('$', '$$').replaceAll('"', '$\\"')
const output = path.join(root, 'result.txt')
const exe = path.join(root, 'directory-test.exe')
const script = [
  'Unicode true', 'RequestExecutionLevel user', 'SilentInstall silent',
  `OutFile "${quote(exe)}"`, '!include LogicLib.nsh', '!include FileFunc.nsh',
  '!define INSTALL_REGISTRY_KEY "Software\\SimpleMusic-Directory-Audit-Never-Written"',
  `!include "${quote(path.resolve('build/windows-directory.nsh'))}"`,
  '!insertmacro SimpleMusicDirectoryFunctions',
  resolver,
  'Section', `FileOpen $9 "${quote(output)}" w`,
  ...cases.flatMap(([input, , resolve]) => [
    `Push "${quote(input)}"`, 'Call SimpleMusicNormalizeInstallDir', 'Pop $0',
    '${If} ${Errors}', '  FileWriteUTF16LE $9 "INVALID$\\r$\\n"',
    '${Else}',
    ...(resolve ? ['  StrCpy $INSTDIR "$0"', '  Call SimpleMusicResolveInstallDirectory', '  StrCpy $0 "$INSTDIR"'] : []),
    '  FileWriteUTF16LE $9 "$0$\\r$\\n"', '${EndIf}'
  ]),
  'FileClose $9', 'SectionEnd'
].join('\n')
try {
  const source = path.join(root, 'directory-test.nsi')
  fs.writeFileSync(source, script)
  const compile = spawnSync(compiler, ['/INPUTCHARSET', 'UTF8', source], { encoding: 'utf8', windowsHide: true })
  assert.equal(compile.status, 0, compile.stdout + compile.stderr)
  const run = spawnSync(exe, [], { timeout: 30000, windowsHide: true })
  assert.equal(run.status, 0, String(run.error || '路径测试未正常退出'))
  const actual = fs.readFileSync(output, 'utf16le').trim().split(/\r?\n/)
  cases.forEach(([input, expected], index) => assert.equal(actual[index], expected ?? 'INVALID', `输入 ${input}`))
  assert.equal(fs.readFileSync(path.join(occupied, '我的文件.txt'), 'utf8'), 'keep')
  console.log(`NSIS 路径函数 ${cases.length} 项实机验收通过（未安装应用）`)
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
