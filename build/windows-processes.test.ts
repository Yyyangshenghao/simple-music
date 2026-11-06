import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./windows-processes.nsh', import.meta.url), 'utf8')
const command = source.split('\n').find(line => line.includes('nsExec::ExecToStack'))!

describe('Windows 安装卸载进程边界', () => {
  it('按完整可执行路径匹配，不按目录前缀或进程名称批量终止', () => {
    expect(command).toContain('$$paths -contains $$_.ExecutablePath')
    expect(source).not.toMatch(/StartsWith\(|Stop-Process|taskkill|KillProcess/)
    expect(command).toContain('Get-CimInstance Win32_Process -ErrorAction Stop')
  })

  it('目标路径和两种已有安装路径通过环境变量传递，合法引号不进入脚本代码', () => {
    expect(command).not.toContain('$INSTDIR')
    expect(command).not.toContain('$R2')
    for (const name of ['INSTALL', 'USER', 'MACHINE']) {
      expect(source).toContain(`SetEnvironmentVariableW(w "SIMPLE_MUSIC_${name}_EXE", w R2)`)
      expect(command).toContain(`$$env:SIMPLE_MUSIC_${name}_EXE`)
    }
    expect(source).toContain('ReadRegStr $R2 HKCU')
    expect(source).toContain('ReadRegStr $R2 HKLM')
  })

  it('查询失败安全中止，静默更新只做有界等待', () => {
    expect(source).toContain('/TIMEOUT=5000')
    expect(source).toContain('${If} $R0 != "1"')
    expect(source).toContain('${If} $R3 >= 10')
    expect(source).toContain('SetErrorLevel 2')
    expect(source).toContain('Sleep 500')
    expect(source).toContain('-NoProfile -NonInteractive')
  })
})
