import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  hide: vi.fn(), release: vi.fn(), ready: false, hostSend: vi.fn(), focus: vi.fn(), send: vi.fn(),
  mini: vi.fn(() => true), wallpaper: vi.fn(() => true),
  setMini: vi.fn(), setWallpaper: vi.fn(), setLyrics: vi.fn()
}))
vi.mock('./window-manager', () => ({
  getMainWindow: () => ({ isDestroyed: () => false, webContents: { send: h.send } }),
  hideMainWindow: h.hide, releaseMainWindow: h.release, focusMainWindow: h.focus
}))
vi.mock('./playback-host', () => ({ isPlaybackHostReady: () => h.ready, sendPlaybackEvent: h.hostSend }))
vi.mock('./overlay-manager', () => ({
  suspendMiniPlayer: h.mini, suspendWallpaper: h.wallpaper,
  setMiniPlayerEnabled: h.setMini, setWallpaperEnabled: h.setWallpaper, setLyricsEnabled: h.setLyrics
}))
import { getGameMode, setGameMode, onGameModeChange, clearGameModeOverlayRestore } from './game-mode'

beforeEach(() => {
  setGameMode({ enabled: false }, false)
  vi.clearAllMocks()
  h.ready = false
  h.mini.mockReturnValue(true)
  h.wallpaper.mockReturnValue(true)
})

describe('游戏模式窗口生命周期', () => {
  it('后台就绪才销毁主 UI，并通知独立运行时继续游戏策略', () => {
    h.ready = true
    setGameMode({ enabled: true })
    expect(h.release).toHaveBeenCalledOnce()
    expect(h.hide).not.toHaveBeenCalled()
    expect(h.hostSend).toHaveBeenCalledWith('game-mode:state-changed', { enabled: true })
  })

  it('收起主窗口、迷你条与壁纸，保留原有桌面歌词状态', () => {
    const notify = vi.fn()
    const stop = onGameModeChange(notify)
    setGameMode({ enabled: true })
    expect(h.hide).toHaveBeenCalledOnce()
    expect(h.mini).toHaveBeenCalledOnce()
    expect(h.wallpaper).toHaveBeenCalledOnce()
    expect(h.setLyrics).not.toHaveBeenCalled()
    expect(h.send).toHaveBeenCalledOnce()
    expect(h.send).toHaveBeenCalledWith('game-mode:state-changed', { enabled: true })
    expect(notify).toHaveBeenCalledOnce()
    stop()
  })

  it('重复进入不覆盖原窗口快照，退出恢复原迷你条与壁纸', () => {
    setGameMode({ enabled: true })
    expect(h.setLyrics).not.toHaveBeenCalled()
    setGameMode({ enabled: true })
    setGameMode({ enabled: false })
    expect(h.mini).toHaveBeenCalledOnce()
    expect(h.wallpaper).toHaveBeenCalledOnce()
    expect(h.setMini).toHaveBeenCalledWith(true)
    expect(h.setWallpaper).toHaveBeenCalledWith(true)
    expect(h.focus).not.toHaveBeenCalled()
  })

  it('后台失联后清除悬浮窗恢复快照，退出游戏只恢复主窗口', () => {
    setGameMode({ enabled: true })
    clearGameModeOverlayRestore()
    expect(getGameMode().enabled).toBe(true)
    expect(h.focus).not.toHaveBeenCalled()
    setGameMode({ enabled: false })
    expect(h.setMini).not.toHaveBeenCalled()
    expect(h.setWallpaper).not.toHaveBeenCalledWith(true)
    expect(h.focus).toHaveBeenCalledOnce()
  })

  it('原来没有迷你条时恢复主窗口，显式显示主窗口不恢复迷你条', () => {
    h.mini.mockReturnValue(false)
    h.wallpaper.mockReturnValue(false)
    setGameMode({ enabled: true })
    setGameMode({ enabled: false })
    expect(h.focus).toHaveBeenCalledOnce()
    expect(h.setMini).not.toHaveBeenCalled()
    expect(h.setWallpaper).not.toHaveBeenCalledWith(true)
    h.mini.mockReturnValue(true)
    setGameMode({ enabled: true })
    setGameMode({ enabled: false }, false)
    expect(h.setMini).not.toHaveBeenCalled()
    expect(h.focus).toHaveBeenCalledOnce()
  })

  it('重复配置不重复操作，返回的快照无法篡改状态', () => {
    setGameMode({ enabled: true })
    setGameMode({ enabled: true })
    expect(h.hide).toHaveBeenCalledOnce()
    const copy = getGameMode()
    copy.enabled = false
    expect(getGameMode().enabled).toBe(true)
  })
})
