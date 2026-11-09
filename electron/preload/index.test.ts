import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopApi } from './index'

const h = vi.hoisted(() => ({ expose: vi.fn() }))
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: h.expose },
  ipcRenderer: {}
}))

describe('主窗口更新能力桥接', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubGlobal('window', { addEventListener: vi.fn() })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it.each([
    ['win32', '', '', false],
    ['win32', 'C:\\Portable', '', true],
    ['win32', '', 'C:\\Portable\\Simple Music.exe', true],
    ['darwin', 'unexpected-marker', '', false],
    ['linux', '', '', false]
  ] as const)('%s 暴露真实便携状态：目录=%s、程序=%s', async (platform, directory, file, expected) => {
    vi.stubGlobal('process', { ...process, platform })
    vi.stubEnv('PORTABLE_EXECUTABLE_DIR', directory)
    vi.stubEnv('PORTABLE_EXECUTABLE_FILE', file)
    await import('./index')
    const api = h.expose.mock.calls[0][1] as DesktopApi
    expect(api.isPortable).toBe(expected)
  })
})
