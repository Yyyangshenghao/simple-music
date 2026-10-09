import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'
import { registerMiscIpc } from './misc'

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  quit: vi.fn(),
  exit: vi.fn(),
  relaunch: vi.fn(),
  exists: vi.fn(() => true),
  installWindows: vi.fn(async () => ({ ok: true } as { ok: boolean; error?: string })),
  installMac: vi.fn(async () => ({ ok: true } as { ok: boolean; error?: string }))
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => h.handlers.set(channel, handler) },
  app: { quit: h.quit, exit: h.exit, relaunch: h.relaunch, getPath: () => '/user-data' },
  dialog: {},
  shell: {}
}))
vi.mock('node:fs', async importOriginal => ({ ...await importOriginal<typeof import('node:fs')>(), existsSync: h.exists }))
vi.mock('../modules/window-manager', () => ({ getMainWindow: vi.fn(), setShortcutRecording: vi.fn() }))
vi.mock('../modules/hotkey-manager', () => ({ configureHotkeys: vi.fn() }))
vi.mock('../modules/settings-menu', () => ({ configureSettingsMenu: vi.fn() }))
vi.mock('../modules/font-manager', () => ({ listSystemFonts: vi.fn() }))
vi.mock('../modules/update-installer', () => ({ installUpdateWindows: h.installWindows, installUpdateMac: h.installMac }))

describe('应用重启和更新退出', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.handlers.clear()
    h.exists.mockReturnValue(true)
    h.installWindows.mockResolvedValue({ ok: true })
    h.installMac.mockResolvedValue({ ok: true })
    registerMiscIpc()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('重启先安排重新启动，再走正常退出清理入口', async () => {
    await expect(h.handlers.get('app:restart')!({})).resolves.toEqual({ ok: true })
    expect(h.relaunch).toHaveBeenCalledOnce()
    expect(h.quit).toHaveBeenCalledOnce()
    expect(h.relaunch.mock.invocationCallOrder[0]).toBeLessThan(h.quit.mock.invocationCallOrder[0])
    expect(h.exit).not.toHaveBeenCalled()
  })

  it.each(['win32', 'darwin'])('%s 安装成功走正常退出，不绕过 before-quit 清理', async platform => {
    vi.stubGlobal('process', { ...process, platform })
    await expect(h.handlers.get('app:install-update')!({}, { filePath: '/user-data/updates/installer' })).resolves.toEqual({ ok: true })
    expect(platform === 'win32' ? h.installWindows : h.installMac).toHaveBeenCalledWith(resolve('/user-data/updates/installer'))
    expect(h.quit).toHaveBeenCalledOnce()
    expect((platform === 'win32' ? h.installWindows : h.installMac).mock.invocationCallOrder[0]).toBeLessThan(h.quit.mock.invocationCallOrder[0])
    expect(h.relaunch).not.toHaveBeenCalled()
    expect(h.exit).not.toHaveBeenCalled()
  })

  it.each(['win32', 'darwin'])('%s 安装失败保留应用和会话', async platform => {
    vi.stubGlobal('process', { ...process, platform })
    const installer = platform === 'win32' ? h.installWindows : h.installMac
    installer.mockResolvedValueOnce({ ok: false, error: 'INSTALL_FAILED' })
    await expect(h.handlers.get('app:install-update')!({}, { filePath: '/user-data/updates/installer' })).resolves.toEqual({ ok: false, error: 'INSTALL_FAILED' })
    expect(h.quit).not.toHaveBeenCalled()
    expect(h.exit).not.toHaveBeenCalled()
  })

  it('更新包不在允许目录内时不启动安装或退出', async () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' })
    await expect(h.handlers.get('app:install-update')!({}, { filePath: '/elsewhere/installer' })).resolves.toEqual({ ok: false, error: 'INVALID_UPDATE_PATH' })
    expect(h.installWindows).not.toHaveBeenCalled()
    expect(h.quit).not.toHaveBeenCalled()
    expect(h.exit).not.toHaveBeenCalled()
  })
})
