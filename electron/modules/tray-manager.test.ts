import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  events: new Map<string, () => void>(),
  restore: vi.fn(), destroy: vi.fn(), quit: vi.fn(), buildMenu: vi.fn(),
  control: vi.fn(), mode: { enabled: false },
  modeListener: undefined as (() => void) | undefined,
}))
vi.mock('electron', () => ({
  Tray: vi.fn(function () {
    return {
      isDestroyed: () => false, destroy: h.destroy,
      setToolTip: vi.fn(), setContextMenu: vi.fn(),
      on: (event: string, callback: () => void) => h.events.set(event, callback),
    }
  }),
  Menu: { buildFromTemplate: h.buildMenu },
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
  app: { quit: h.quit },
}))
vi.mock('./overlay-manager', () => ({ returnFromMiniPlayer: h.restore, triggerMiniPlayerControl: h.control }))
vi.mock('./game-mode', () => ({
  getGameMode: () => ({ ...h.mode }),
  setGameMode: vi.fn((state: typeof h.mode) => { h.mode = state; h.modeListener?.(); return state }),
  onGameModeChange: (listener: () => void) => { h.modeListener = listener; return () => { h.modeListener = undefined } }
}))

import { createTray, destroyTray, updateTrayPlayback } from './tray-manager'
import { getGameMode, setGameMode } from './game-mode'

describe('托盘恢复迷你模式', () => {
  beforeEach(() => {
    destroyTray()
    vi.clearAllMocks()
    h.mode = { enabled: false }
    h.events.clear()
    updateTrayPlayback({ title: '', artist: '', playing: false, hasTrack: false, canSkip: false, volume: 1, desktopLyrics: false })
    createTray()
  })

  it('双击统一退出迷你模式并恢复主窗口', () => {
    h.events.get('double-click')!()
    expect(h.restore).toHaveBeenCalledOnce()
  })

  it('macOS 单击保留托盘菜单，其他平台单击返回主窗口', () => {
    if (process.platform === 'darwin') expect(h.events.has('click')).toBe(false)
    else {
      h.events.get('click')!()
      expect(h.restore).toHaveBeenCalledOnce()
    }
  })

  it('显示主窗口菜单走同一恢复路径，退出菜单真正退出应用', () => {
    const items = h.buildMenu.mock.calls[0][0] as Electron.MenuItemConstructorOptions[]
    const show = items.find((item) => item.label === '显示主窗口')!
    const quit = items.find((item) => item.label === '退出')!
    const showWindow = show.click as () => void
    const quitApp = quit.click as () => void
    showWindow()
    quitApp()
    expect(h.restore).toHaveBeenCalledOnce()
    expect(h.quit).toHaveBeenCalledOnce()
  })

  it('重复创建不重复注册监听，销毁后可重新创建', () => {
    createTray()
    expect(h.buildMenu).toHaveBeenCalledOnce()
    destroyTray()
    createTray()
    expect(h.destroy).toHaveBeenCalledOnce()
    expect(h.buildMenu).toHaveBeenCalledTimes(2)
  })

  it('曲目、播放与歌词状态更新菜单，同值更新不重复重建', () => {
    const state = { title: '歌曲', artist: '歌手', playing: true, hasTrack: true, canSkip: true, volume: 0.4, desktopLyrics: true }
    updateTrayPlayback(state)
    const items = h.buildMenu.mock.calls.at(-1)![0] as Electron.MenuItemConstructorOptions[]
    expect(items[0].label).toBe('歌曲 · 歌手')
    expect(items.find(item => item.label === '暂停')?.enabled).toBe(true)
    expect(items.find(item => item.label === '桌面歌词')?.checked).toBe(true)
    updateTrayPlayback(state)
    expect(h.buildMenu).toHaveBeenCalledTimes(2)
  })

  it('基础播放和音量命令不恢复主窗口，静音后恢复原音量', () => {
    updateTrayPlayback({ title: '歌曲', artist: '', playing: true, hasTrack: true, canSkip: true, volume: 0.4, desktopLyrics: false })
    let items = h.buildMenu.mock.calls.at(-1)![0] as Electron.MenuItemConstructorOptions[]
    for (const label of ['暂停', '上一首', '下一首']) (items.find(item => item.label === label)!.click as () => void)()
    const volumeItems = items.find(item => item.label === '音量')!.submenu as Electron.MenuItemConstructorOptions[]
    ;(volumeItems.find(item => item.label === '静音')!.click as () => void)()
    expect(h.control.mock.calls).toEqual([['play-pause', undefined], ['prev', undefined], ['next', undefined], ['volume', 0]])
    updateTrayPlayback({ title: '歌曲', artist: '', playing: false, hasTrack: true, canSkip: true, volume: 0, desktopLyrics: false })
    items = h.buildMenu.mock.calls.at(-1)![0] as Electron.MenuItemConstructorOptions[]
    const muted = items.find(item => item.label === '音量')!.submenu as Electron.MenuItemConstructorOptions[]
    ;(muted.find(item => item.label === '取消静音')!.click as () => void)()
    expect(h.control).toHaveBeenLastCalledWith('volume', 0.4)
    expect(h.restore).not.toHaveBeenCalled()
  })

  it('游戏模式沿用普通桌面歌词控制，显示主窗口结束游戏模式', () => {
    let items = h.buildMenu.mock.calls.at(-1)![0] as Electron.MenuItemConstructorOptions[]
    ;(items.find(item => item.label === '游戏模式')!.click as () => void)()
    expect(getGameMode().enabled).toBe(true)
    items = h.buildMenu.mock.calls.at(-1)![0] as Electron.MenuItemConstructorOptions[]
    expect(items.find(item => item.label === '桌面歌词')?.checked).toBe(false)
    ;(items.find(item => item.label === '桌面歌词')!.click as () => void)()
    expect(h.control).toHaveBeenLastCalledWith('desktop-lyrics')
    expect(getGameMode()).toEqual({ enabled: true })
    updateTrayPlayback({ title: '', artist: '', playing: false, hasTrack: false, canSkip: false, volume: 1, desktopLyrics: true })
    items = h.buildMenu.mock.calls.at(-1)![0] as Electron.MenuItemConstructorOptions[]
    expect(items.find(item => item.label === '桌面歌词')?.checked).toBe(true)
    ;(items.find(item => item.label === '显示主窗口')!.click as () => void)()
    expect(setGameMode).toHaveBeenLastCalledWith({ enabled: false }, false)
    expect(h.restore).toHaveBeenCalledOnce()
  })

  it('空队列且没有曲目时，菜单回调不发播放命令', () => {
    const items = h.buildMenu.mock.calls.at(-1)![0] as Electron.MenuItemConstructorOptions[]
    ;(items.find(item => item.label === '播放')!.click as () => void)()
    ;(items.find(item => item.label === '下一首')!.click as () => void)()
    expect(h.control).not.toHaveBeenCalled()
  })
})
