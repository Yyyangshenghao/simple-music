import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { packageFiles, removalScript, prepareWindowsUninstall } = require('./windows-uninstall.cjs')
const { installScripts, MANIFEST } = require('./windows-install.cjs')
const roots: string[] = []
function temp() {
  const root = mkdtempSync(path.join(tmpdir(), 'simple-music-uninstall-'))
  roots.push(root)
  return root
}
function put(root: string, name: string) {
  mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
  writeFileSync(path.join(root, name), name)
}
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })))

describe('Windows 卸载文件归属', () => {
  it('卸载指令只删除打包文件，并保留同目录和资源子目录中的用户文件', () => {
    const packed = temp()
    const installed = temp()
    const owned = ['Simple Music.exe', 'resources/app.asar', 'resources/native/module.node']
    for (const name of owned) put(packed, name)
    const script = removalScript(packageFiles(packed))
    for (const name of [...owned, 'Uninstall Simple Music.exe', 'uninstallerIcon.ico', MANIFEST, '我的音乐/a.mp3', 'notes.txt', 'resources/user.txt']) put(installed, name)
    // 执行生成的 Delete / RMDir 指令：测试真实清单边界，非递归目录删除沿用系统语义。
    const instructions = script
    expect(instructions).not.toMatch(/RMDir\s+\/r|Delete\s+\/REBOOTOK|\*\.\*/i)
    for (const line of instructions.split('\n')) {
      const match = line.match(/^\s*(Delete|RMDir) "\$INSTDIR(?:\\(.*))?"$/)
      if (!match) continue
      const target = path.join(installed, (match[2] || '').replace('${UNINSTALL_FILENAME}', 'Uninstall Simple Music.exe').replaceAll('\\', '/'))
      if (match[1] === 'Delete') unlinkSync(target)
      else {
        try { rmdirSync(target) } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOTEMPTY') throw error
        }
      }
    }
    expect(readdirSync(installed).sort()).toEqual(['notes.txt', 'resources', '我的音乐'])
    expect(readFileSync(path.join(installed, 'resources/user.txt'), 'utf8')).toBe('resources/user.txt')
    expect(readFileSync(path.join(installed, '我的音乐/a.mp3'), 'utf8')).toBe('我的音乐/a.mp3')
  })

  it('卸载先核对构建身份、链接和占用，之后才开始删除', () => {
    const script = removalScript(['Simple Music.exe', 'resources/app.asar'], 'package-id')
    expect(script).not.toMatch(/FindFirst|atomicRMDir|RMDir\s+\/r/)
    expect(script).toContain('$0 != "package-id"')
    expect(script.indexOf('SimpleMusicCheckFile "un." "$INSTDIR\\resources\\app.asar"')).toBeLessThan(script.indexOf('Delete '))
    expect(script.lastIndexOf('CreateFileW')).toBeLessThan(script.indexOf('Delete '))
    expect(script).toContain('RMDir "$INSTDIR\\resources"')
  })

  it('升级不会启动旧版危险卸载器，包括主路径执行失败后的回退', () => {
    const root = temp()
    const appOutDir = path.join(root, 'win-unpacked')
    put(appOutDir, 'Simple Music.exe')
    prepareWindowsUninstall({ electronPlatformName: 'win32', appOutDir, packager: { projectDir: root } })
    const util = readFileSync(path.join(root, 'dist/nsis-safe/installUtil.nsh'), 'utf8')
    expect(util).not.toContain('ExecWait')
    expect(util).not.toContain('copyFile "$uninstallerFileName"')
    const section = readFileSync(path.join(root, 'dist/nsis-safe/installSection.nsh'), 'utf8')
    expect(section.indexOf('Call SimpleMusicBeginTransaction')).toBeLessThan(section.indexOf('File /oname=uninstallerIcon.ico'))
    expect(section.indexOf('Call SimpleMusicCommitFiles')).toBeLessThan(section.indexOf('!insertmacro registryAddInstallInfo'))
    expect(section.indexOf('Call SimpleMusicFinishTransaction')).toBeGreaterThan(section.indexOf('!insertmacro addDesktopLink'))
    const manifest = readFileSync(path.join(root, 'dist/nsis-safe/install-manifest.ini'))
    expect(manifest.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xfe]))
  })

  it('拒绝打包符号链接，避免清单越过构建目录', () => {
    const root = temp()
    symlinkSync(temp(), path.join(root, 'external'), 'junction')
    expect(() => packageFiles(root)).toThrow('不安全的 Windows 打包路径')
  })

  it('签名后刷新文件清单，并拒绝会被解释为 NSIS 宏的文件名', () => {
    const root = temp()
    const appOutDir = path.join(root, 'win-unpacked')
    put(appOutDir, 'Simple Music.exe')
    const context = { electronPlatformName: 'win32', appOutDir, packager: { projectDir: root } }
    prepareWindowsUninstall(context)
    put(appOutDir, 'resources/production.sig')
    prepareWindowsUninstall(context)
    expect(readFileSync(path.join(root, 'dist/nsis-safe/remove-files.nsh'), 'utf8')).toContain('$INSTDIR\\resources\\production.sig')
    put(appOutDir, '${UNSAFE}.bin')
    expect(() => prepareWindowsUninstall(context)).toThrow('不安全的 Windows 打包路径')
  })

  it('完整校验暂存包后才备份旧文件，备份由父安装器持有直到写入入口完成', () => {
    const root = temp()
    put(root, 'Simple Music.exe')
    put(root, 'resources/app.asar')
    const { script } = installScripts(packageFiles(root), root)
    expect(script).not.toMatch(/RMDir\s+\/r|PLUGINSDIR\\old-install/)
    expect(script).toContain('GetTempFileName $SimpleMusicBackupDir "$INSTDIR"')
    expect(script.indexOf('SHA2-256')).toBeLessThan(script.indexOf('Rename "$INSTDIR'))
    expect(script).toContain('Rename "$SimpleMusicBackupDir\\resources\\app.asar" "$INSTDIR\\resources\\app.asar"')
    expect(script).toContain('DeleteRegKey /ifempty SHELL_CONTEXT')
    expect(script).toContain('SimpleMusicWritten_')
    expect(script).toContain('ReadINIStr $0 "$INSTDIR\\.simple-music-install.ini" "files"')
    expect(script).toContain('StrCpy $2 "$INSTDIR\\Simple Music-${VERSION}"')
  })
})
