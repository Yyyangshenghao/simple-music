import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { join, parse, resolve } from 'node:path'
import { registerMiscIpc } from './misc'

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  quit: vi.fn(),
  exit: vi.fn(),
  relaunch: vi.fn(),
  exists: vi.fn(() => true),
  findLocalTrack: vi.fn(),
  stat: vi.fn(),
  showItemInFolder: vi.fn(),
  installWindows: vi.fn(async () => ({ ok: true } as { ok: boolean; error?: string })),
  installMac: vi.fn(async () => ({ ok: true } as { ok: boolean; error?: string }))
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => h.handlers.set(channel, handler) },
  app: { quit: h.quit, exit: h.exit, relaunch: h.relaunch, getPath: () => '/user-data' },
  dialog: {},
  shell: { showItemInFolder: h.showItemInFolder }
}))
vi.mock('node:fs', async importOriginal => {
  const original = await importOriginal<typeof import('node:fs')>()
  return { ...original, existsSync: h.exists, promises: { ...original.promises, stat: h.stat } }
})
vi.mock('../../server/lib/local-library', () => ({ findLocalTrack: h.findLocalTrack }))
vi.mock('../modules/window-manager', () => ({ getMainWindow: vi.fn(), setShortcutRecording: vi.fn() }))
vi.mock('../modules/hotkey-manager', () => ({ configureHotkeys: vi.fn() }))
vi.mock('../modules/settings-menu', () => ({ configureSettingsMenu: vi.fn() }))
vi.mock('../modules/font-manager', () => ({ listSystemFontsCached: vi.fn() }))
vi.mock('../modules/update-installer', () => ({ installUpdateWindows: h.installWindows, installUpdateMac: h.installMac }))

describe('应用重启和更新退出', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.handlers.clear()
    h.exists.mockReturnValue(true)
    h.installWindows.mockResolvedValue({ ok: true })
    h.installMac.mockResolvedValue({ ok: true })
    vi.stubEnv('SIMPLEMUSIC_UPDATE_DIR', '')
    vi.stubEnv('SIMPLEMUSIC_UPDATE_DOWNLOAD_DIR', '')
    registerMiscIpc()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

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

  it.each(['win32', 'darwin'])('%s 支持工作目录和下载目录覆盖，下载目录优先', async platform => {
    vi.stubGlobal('process', { ...process, platform })
    const installer = platform === 'win32' ? h.installWindows : h.installMac
    for (const [workDir, downloadDir, filePath] of [
      ['', '', '/user-data/updates/downloads/installer'],
      ['/custom-updates', '', '/custom-updates/downloads/installer'],
      ['', '/custom-downloads', '/custom-downloads/installer'],
      ['/custom-updates', '/custom-downloads', '/custom-downloads/installer']
    ]) {
      vi.stubEnv('SIMPLEMUSIC_UPDATE_DIR', workDir)
      vi.stubEnv('SIMPLEMUSIC_UPDATE_DOWNLOAD_DIR', downloadDir)
      await expect(h.handlers.get('app:install-update')!({}, { filePath })).resolves.toEqual({ ok: true })
      expect(installer).toHaveBeenLastCalledWith(resolve(filePath))
    }
  })

  it.each([
    '/custom-downloads-other/installer',
    '/custom-downloads/../installer',
    '/custom-updates/downloads/installer',
    '/user-data/updates/downloads/installer'
  ])('下载目录覆盖后拒绝其它目录 %s', async filePath => {
    vi.stubGlobal('process', { ...process, platform: 'win32' })
    vi.stubEnv('SIMPLEMUSIC_UPDATE_DIR', '/custom-updates')
    vi.stubEnv('SIMPLEMUSIC_UPDATE_DOWNLOAD_DIR', '/custom-downloads')
    await expect(h.handlers.get('app:install-update')!({}, { filePath })).resolves.toEqual({ ok: false, error: 'INVALID_UPDATE_PATH' })
    expect(h.installWindows).not.toHaveBeenCalled()
    expect(h.quit).not.toHaveBeenCalled()
  })

  it.each(['win32', 'darwin'])('%s 自定义下载目录为宿主盘符根时允许安装包', async platform => {
    vi.stubGlobal('process', { ...process, platform })
    const root = parse(resolve('installer')).root
    const filePath = join(root, 'installer')
    vi.stubEnv('SIMPLEMUSIC_UPDATE_DOWNLOAD_DIR', root)

    await expect(h.handlers.get('app:install-update')!({}, { filePath })).resolves.toEqual({ ok: true })
    expect(platform === 'win32' ? h.installWindows : h.installMac).toHaveBeenCalledWith(filePath)
    expect(h.quit).toHaveBeenCalledOnce()
  })

  it('下载目录为宿主盘符根时仍拒绝根目录本身', async () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' })
    const root = parse(resolve('installer')).root
    vi.stubEnv('SIMPLEMUSIC_UPDATE_DOWNLOAD_DIR', root)

    await expect(h.handlers.get('app:install-update')!({}, { filePath: root })).resolves.toEqual({ ok: false, error: 'INVALID_UPDATE_PATH' })
    expect(h.installWindows).not.toHaveBeenCalled()
    expect(h.quit).not.toHaveBeenCalled()
  })

  it('自定义目录安装失败保留应用和会话', async () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' })
    vi.stubEnv('SIMPLEMUSIC_UPDATE_DIR', '/custom-updates')
    h.installWindows.mockResolvedValueOnce({ ok: false, error: 'INSTALL_FAILED' })
    await expect(h.handlers.get('app:install-update')!({}, { filePath: '/custom-updates/downloads/installer' })).resolves.toEqual({ ok: false, error: 'INSTALL_FAILED' })
    expect(h.quit).not.toHaveBeenCalled()
    expect(h.exit).not.toHaveBeenCalled()
  })

  it('自定义目录更新包缺失时不安装或退出', async () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' })
    vi.stubEnv('SIMPLEMUSIC_UPDATE_DOWNLOAD_DIR', '/custom-downloads')
    h.exists.mockReturnValueOnce(false)
    await expect(h.handlers.get('app:install-update')!({}, { filePath: '/custom-downloads/installer' })).resolves.toEqual({ ok: false, error: 'UPDATE_FILE_MISSING' })
    expect(h.installWindows).not.toHaveBeenCalled()
    expect(h.quit).not.toHaveBeenCalled()
  })
})

describe('本地曲目文件定位', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.handlers.clear()
    h.findLocalTrack.mockResolvedValue({ id: 'indexed-id', path: '/music/album/song.flac' })
    h.stat.mockResolvedValue({ isFile: () => true })
    registerMiscIpc()
  })

  it('只按索引 ID 找到原文件，再交给系统定位', async () => {
    await expect(h.handlers.get('file:reveal-local-track')!({}, { id: 'indexed-id', path: '/untrusted/file' })).resolves.toEqual({ ok: true })
    expect(h.findLocalTrack).toHaveBeenCalledWith('/user-data', 'indexed-id')
    expect(h.stat).toHaveBeenCalledWith('/music/album/song.flac')
    expect(h.showItemInFolder).toHaveBeenCalledWith('/music/album/song.flac')
  })

  it.each([undefined, {}, { id: '' }, { id: '  ' }, { id: 123 }, { path: '/music/song.flac' }])('拒绝无效 ID 或直传路径：%s', async payload => {
    await expect(h.handlers.get('file:reveal-local-track')!({}, payload)).resolves.toEqual({ ok: false, error: 'INVALID_LOCAL_TRACK_ID' })
    expect(h.findLocalTrack).not.toHaveBeenCalled()
    expect(h.showItemInFolder).not.toHaveBeenCalled()
  })

  it('索引没有此曲目时不打开任意文件', async () => {
    h.findLocalTrack.mockResolvedValueOnce(null)
    await expect(h.handlers.get('file:reveal-local-track')!({}, { id: '/music/song.flac' })).resolves.toEqual({ ok: false, error: 'LOCAL_TRACK_NOT_FOUND' })
    expect(h.stat).not.toHaveBeenCalled()
    expect(h.showItemInFolder).not.toHaveBeenCalled()
  })

  it('索引目标不再是文件时返回错误', async () => {
    h.stat.mockResolvedValueOnce({ isFile: () => false })
    await expect(h.handlers.get('file:reveal-local-track')!({}, { id: 'indexed-id' })).resolves.toEqual({ ok: false, error: 'LOCAL_TRACK_FILE_MISSING' })
    expect(h.showItemInFolder).not.toHaveBeenCalled()
  })

  it('文件丢失或系统定位失败时返回失败，不向渲染层抛异常', async () => {
    h.stat.mockRejectedValueOnce(new Error('ENOENT'))
    await expect(h.handlers.get('file:reveal-local-track')!({}, { id: 'indexed-id' })).resolves.toEqual({ ok: false, error: 'REVEAL_LOCAL_TRACK_FAILED' })
    expect(h.showItemInFolder).not.toHaveBeenCalled()
    h.showItemInFolder.mockImplementationOnce(() => { throw new Error('FAILED') })
    await expect(h.handlers.get('file:reveal-local-track')!({}, { id: 'indexed-id' })).resolves.toEqual({ ok: false, error: 'REVEAL_LOCAL_TRACK_FAILED' })
  })
})
