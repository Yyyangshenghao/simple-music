import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => {
  const instances: Array<{
    bounds: Electron.Rectangle
    listeners: Map<string, () => void>
    close: ReturnType<typeof vi.fn>
    setBounds: ReturnType<typeof vi.fn>
    setResizable: ReturnType<typeof vi.fn>
    setOpacity: ReturnType<typeof vi.fn>
    setIgnoreMouseEvents: ReturnType<typeof vi.fn>
    showInactive: ReturnType<typeof vi.fn>
    show: ReturnType<typeof vi.fn>
    webContents: { send: ReturnType<typeof vi.fn>; once: ReturnType<typeof vi.fn>; getZoomFactor: ReturnType<typeof vi.fn> }
  }> = []
  const mainSend = vi.fn()
  const hideMainWindow = vi.fn()
  const focusMainWindow = vi.fn()
  const cursor = { x: -100, y: -100 }
  const getDisplayMatching = vi.fn((_bounds: Electron.Rectangle) => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }))

  const BrowserWindow = vi.fn(function (options: Electron.BrowserWindowConstructorOptions) {
    const listeners = new Map<string, () => void>()
    const win = {
      bounds: {
        x: options.x ?? 0,
        y: options.y ?? 0,
        width: options.width ?? 0,
        height: options.height ?? 0
      },
      listeners,
      webContents: {
        setWindowOpenHandler: vi.fn(),
        getZoomFactor: vi.fn(() => 1),
        on: vi.fn(),
        once: vi.fn(),
        send: vi.fn()
      },
      isDestroyed: vi.fn(() => false),
      setAlwaysOnTop: vi.fn(),
      setVisibleOnAllWorkspaces: vi.fn(),
      showInactive: vi.fn(),
      show: vi.fn(),
      close: vi.fn(),
      setResizable: vi.fn(),
      setOpacity: vi.fn(),
      setIgnoreMouseEvents: vi.fn(),
      getBounds: vi.fn(() => ({ ...win.bounds })),
      setBounds: vi.fn((bounds: Electron.Rectangle) => {
        win.bounds = { ...bounds }
      }),
      once: vi.fn((event: string, listener: () => void) => { listeners.set(event, listener) }),
      on: vi.fn((event: string, listener: () => void) => {
        listeners.set(event, listener)
      }),
      loadURL: vi.fn(() => Promise.resolve())
    }
    instances.push(win)
    return win
  })

  return { BrowserWindow, instances, mainSend, hideMainWindow, focusMainWindow, cursor, getDisplayMatching }
})

vi.mock('electron', () => ({
  BrowserWindow: harness.BrowserWindow,
  screen: {
    getCursorScreenPoint: () => harness.cursor,
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    getDisplayMatching: harness.getDisplayMatching
  }
}))

vi.mock('./window-manager', () => ({
  getMainWindow: () => ({ isDestroyed: () => false, webContents: { send: harness.mainSend } }),
  resolveRendererUrl: () => 'file:///mini-player.html',
  hideMainWindow: harness.hideMainWindow,
  focusMainWindow: harness.focusMainWindow,
  isInAppUrl: () => true
}))

vi.mock('./safe-open', () => ({ openExternalSafely: vi.fn() }))
vi.mock('./macos-lyrics-window', () => ({ preventLyricsActivation: vi.fn(() => true) }))
vi.mock('../platform', () => ({
  getPlatform: () => ({
    startMousePoller: vi.fn(),
    stopMousePoller: vi.fn(),
    attachWallpaperToDesktop: vi.fn(),
    ensureDesktopShortcut: vi.fn()
  })
}))

import { moveMiniPlayerBy, resizeMiniPlayerBy, returnFromMiniPlayer, setMiniPlayerEnabled, updateMiniPlayer, setLyricsEnabled, updateLyrics, moveLyricsBy, resizeLyrics, setLyricsLock, setLyricsControlBounds, closeOverlays } from './overlay-manager'
import { DEFAULT_MINI_PLAYER_APPEARANCE } from '../../src/lib/mini-player-config'
import { desktopLyricsHeight, desktopLyricsSize } from '../../src/lib/desktop-lyrics-layout'
import { preventLyricsActivation } from './macos-lyrics-window'

it('歌词请求确认与悬浮窗主动关闭使用不同通知，避免旧确认覆盖最新意图', () => {
  setLyricsEnabled(false, {}, true)
  expect(harness.mainSend).toHaveBeenLastCalledWith('lyrics:enabled-state-changed', { enabled: false, requested: true })
  setLyricsEnabled(false)
  expect(harness.mainSend).toHaveBeenLastCalledWith('lyrics:enabled-state-changed', { enabled: false })
})

describe('桌面歌词窗口交互', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.assign(harness.cursor, { x: -100, y: -100 })
    setLyricsEnabled(false)
    harness.instances.length = 0
    harness.mainSend.mockReset()
  })
  afterEach(() => {
    setLyricsEnabled(false)
    vi.useRealTimers()
  })
  it('窗口紧凑，解锁时可直接交互，锁定穿透且不允许拖动', () => {
    setLyricsEnabled(true, { clickThrough: false, opacity: 0.92 })
    const win = harness.instances[0]
    expect(win.bounds.height).toBe(90)
    expect(win.bounds.width).toBe(680)
    if (process.platform === 'darwin') {
      expect(win.setResizable).toHaveBeenCalledWith(true)
      expect(win.setResizable).toHaveBeenLastCalledWith(false)
    } else expect(win.setResizable).not.toHaveBeenCalled()
    expect(win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false, { forward: true })
    updateLyrics({ opacity: 0.5 })
    expect(win.setOpacity).toHaveBeenLastCalledWith(0.5)
    setLyricsLock(true)
    expect(win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true })
    expect(moveLyricsBy(30, 20)).toEqual({ ok: false, error: 'DESKTOP_LYRICS_LOCKED' })
    expect(harness.mainSend).toHaveBeenCalledWith('lyrics:lock-state-changed', { locked: true })
    setLyricsLock(false)
    win.bounds = { ...win.bounds, x: 0, y: 0 }
    moveLyricsBy(-160, -160)
    expect(win.bounds.x).toBe(0)
    expect(win.bounds.y).toBe(0)
  })
  it('旧窗口延迟 closed 不影响新窗口，退出不清除开启偏好', () => {
    setLyricsEnabled(true, { clickThrough: false })
    const first = harness.instances[0]
    setLyricsEnabled(false)
    setLyricsEnabled(true)
    const second = harness.instances[1]
    first.listeners.get('closed')?.()
    updateLyrics({ line: '新歌词' })
    expect(second.webContents.send).toHaveBeenLastCalledWith('overlay:lyrics-state', expect.objectContaining({ line: '新歌词' }))
    closeOverlays()
    expect(harness.mainSend).toHaveBeenCalledWith('lyrics:enabled-state-changed', { enabled: false, requested: true })
  })
  it('锁定后隐藏操作条，歌词悬停满 0.5 秒显示解锁，移动到图标仍可点击', () => {
    setLyricsEnabled(true, { clickThrough: true })
    const win = harness.instances[0]
    setLyricsControlBounds({ left: 490, top: 6, right: 530, bottom: 40, hover: { left: 400, top: 60, right: 620, bottom: 84 } })
    Object.assign(harness.cursor, { x: win.bounds.x + 500, y: win.bounds.y + 75 })
    vi.advanceTimersByTime(50)
    vi.advanceTimersByTime(499)
    expect(win.webContents.send).not.toHaveBeenCalledWith('overlay:lyrics-state', expect.objectContaining({ unlockVisible: true }))
    expect(win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true })
    vi.advanceTimersByTime(1)
    expect(win.webContents.send).toHaveBeenLastCalledWith('overlay:lyrics-state', expect.objectContaining({ unlockVisible: true }))
    // 歌词依旧穿透，只有图标接收点击；移向图标的间隙不关闭提示。
    Object.assign(harness.cursor, { x: win.bounds.x + 500, y: win.bounds.y + 55 })
    vi.advanceTimersByTime(50)
    expect(win.webContents.send).toHaveBeenLastCalledWith('overlay:lyrics-state', expect.objectContaining({ unlockVisible: true }))
    expect(win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true })
    Object.assign(harness.cursor, { x: win.bounds.x + 500, y: win.bounds.y + 20 })
    vi.advanceTimersByTime(50)
    expect(win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false, { forward: true })
    expect(moveLyricsBy(20, 20)).toMatchObject({ ok: false, error: 'DESKTOP_LYRICS_LOCKED' })
    setLyricsLock(false)
    expect(win.webContents.send).toHaveBeenLastCalledWith('overlay:lyrics-state', expect.objectContaining({ unlockVisible: false, clickThrough: false }))
    expect(win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false, { forward: true })
    expect(moveLyricsBy(20, 20)).toEqual({ ok: true })
    vi.advanceTimersByTime(200)
    expect(vi.getTimerCount()).toBe(0)
    setLyricsLock(true)
    setLyricsEnabled(false)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('快速掠过或只停在隐藏图标上不显示解锁，离开后重新计时', () => {
    setLyricsEnabled(true, { clickThrough: true })
    const win = harness.instances[0]
    setLyricsControlBounds({ left: 490, top: 6, right: 530, bottom: 40, hover: { left: 400, top: 60, right: 620, bottom: 84 } })
    Object.assign(harness.cursor, { x: win.bounds.x + 500, y: win.bounds.y + 20 })
    vi.advanceTimersByTime(1000)
    expect(win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true })
    Object.assign(harness.cursor, { x: win.bounds.x + 500, y: win.bounds.y + 75 })
    vi.advanceTimersByTime(450)
    Object.assign(harness.cursor, { x: -100, y: -100 })
    vi.advanceTimersByTime(50)
    Object.assign(harness.cursor, { x: win.bounds.x + 500, y: win.bounds.y + 75 })
    vi.advanceTimersByTime(500)
    expect(win.webContents.send).not.toHaveBeenCalledWith('overlay:lyrics-state', expect.objectContaining({ unlockVisible: true }))
    vi.advanceTimersByTime(50)
    expect(win.webContents.send).toHaveBeenLastCalledWith('overlay:lyrics-state', expect.objectContaining({ unlockVisible: true }))
    Object.assign(harness.cursor, { x: -100, y: -100 })
    vi.advanceTimersByTime(50)
    expect(win.webContents.send).toHaveBeenLastCalledWith('overlay:lyrics-state', expect.objectContaining({ unlockVisible: false }))
    expect(win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true })
  })
  it('歌词更新不打断悬停，重新锁定或开启窗口不会沿用旧提示和热区', () => {
    setLyricsEnabled(true, { clickThrough: true })
    const first = harness.instances[0]
    Object.assign(harness.cursor, { x: first.bounds.x + 500, y: first.bounds.y + 75 })
    setLyricsControlBounds({ left: 490, top: 6, right: 530, bottom: 40, hover: { left: 400, top: 60, right: 620, bottom: 84 } })
    vi.advanceTimersByTime(250)
    updateLyrics({ line: '新歌词' })
    vi.advanceTimersByTime(250)
    expect(first.webContents.send).toHaveBeenLastCalledWith('overlay:lyrics-state', expect.objectContaining({ unlockVisible: true, line: '新歌词' }))
    setLyricsLock(false)
    setLyricsLock(true)
    expect(first.webContents.send).toHaveBeenLastCalledWith('overlay:lyrics-state', expect.objectContaining({ unlockVisible: false }))
    setLyricsEnabled(false)
    setLyricsEnabled(true, { clickThrough: true })
    const next = harness.instances[1]
    next.listeners.get('ready-to-show')?.()
    vi.advanceTimersByTime(1000)
    expect(next.webContents.send).toHaveBeenLastCalledWith('overlay:lyrics-state', expect.objectContaining({ unlockVisible: false }))
    setLyricsControlBounds({ left: 0, top: 0, right: 0, bottom: 0 })
    expect(next.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true })
  })
  it('页面缩放后歌词悬停与图标 CSS 坐标均换算为 DIP', () => {
    setLyricsEnabled(true, { clickThrough: true })
    const win = harness.instances[0]
    win.webContents.getZoomFactor.mockReturnValue(1.25)
    setLyricsControlBounds({ left: 400, top: 6, right: 500, bottom: 40, hover: { left: 400, top: 60, right: 500, bottom: 100 } })
    Object.assign(harness.cursor, { x: win.bounds.x + 560, y: win.bounds.y + 75 })
    vi.advanceTimersByTime(550)
    expect(win.webContents.send).toHaveBeenLastCalledWith('overlay:lyrics-state', expect.objectContaining({ unlockVisible: true }))
    Object.assign(harness.cursor, { x: win.bounds.x + 560, y: win.bounds.y + 20 })
    vi.advanceTimersByTime(50)
    expect(win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false, { forward: true })
    Object.assign(harness.cursor, { x: win.bounds.x + 420, y: win.bounds.y + 20 })
    vi.advanceTimersByTime(50)
    expect(win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true })
    expect(win.webContents.send).toHaveBeenLastCalledWith('overlay:lyrics-state', expect.objectContaining({ unlockVisible: false }))
  })
  it('最大字号加翻译在页面放大后增加高度，恢复缩放回到紧凑尺寸', () => {
    setLyricsEnabled(true, { clickThrough: false, size: 48, translation: '译文' })
    const win = harness.instances[0]
    win.bounds.y = 200
    const centerY = win.bounds.y + win.bounds.height / 2
    win.webContents.getZoomFactor.mockReturnValue(1.25)
    setLyricsControlBounds({ left: 300, top: 8, right: 328, bottom: 36 })
    expect(win.bounds.height).toBe(172)
    expect(win.bounds.width).toBe(680)
    expect(Math.abs(win.bounds.y + win.bounds.height / 2 - centerY)).toBeLessThanOrEqual(0.5)
    win.webContents.getZoomFactor.mockReturnValue(1)
    setLyricsControlBounds({ left: 300, top: 8, right: 328, bottom: 36 })
    expect(win.bounds.height).toBe(138)
  })
  it('自定义宽高不会被热区更新重置，锁定禁止缩放，重新开启保留尺寸', () => {
    setLyricsEnabled(true, { clickThrough: false, size: 38, translation: '' })
    const win = harness.instances[0]
    resizeLyrics(420, 90)
    expect(win.bounds).toMatchObject({ width: 420, height: 90 })
    setLyricsControlBounds({ left: 190, top: 2, right: 218, bottom: 30 })
    expect(win.bounds).toMatchObject({ width: 420, height: 90 })
    setLyricsLock(true)
    expect(resizeLyrics(700, 180)).toEqual({ ok: false, error: 'DESKTOP_LYRICS_LOCKED' })
    expect(win.bounds).toMatchObject({ width: 420, height: 90 })
    setLyricsEnabled(false)
    setLyricsEnabled(true, { clickThrough: false })
    const next = harness.instances[1]
    setLyricsControlBounds({ left: 190, top: 2, right: 218, bottom: 30 })
    expect(next.bounds).toMatchObject({ width: 420, height: 90 })
    updateLyrics({ translation: '翻译' })
    setLyricsControlBounds({ left: 190, top: 2, right: 218, bottom: 30 })
    expect(next.bounds).toMatchObject({ width: 420, height: 90 })
    resizeLyrics(-100, -100)
    expect(next.bounds).toMatchObject({ width: 280, height: 74 })
    resizeLyrics(10000, 10000)
    expect(next.bounds).toMatchObject({ x: 0, y: 0, width: 1920, height: 1080 })
  })
  it('拉高底框同步变大字号；仅改宽度保持字号；设置字号改变高度而非宽度', () => {
    setLyricsEnabled(true, { clickThrough: false, size: 38, translation: '' })
    const win = harness.instances[0]
    resizeLyrics(500, 180)
    const size = desktopLyricsSize(180, false)
    expect(harness.mainSend).toHaveBeenCalledWith('lyrics:size-changed', { size })
    expect(win.webContents.send).toHaveBeenLastCalledWith('overlay:lyrics-state', expect.objectContaining({ size }))
    harness.mainSend.mockClear()
    resizeLyrics(800, 180)
    expect(harness.mainSend).not.toHaveBeenCalledWith('lyrics:size-changed', expect.anything())
    updateLyrics({ size: 72, fontFamily: 'Songti SC', color: '#ffe29a' })
    expect(win.bounds).toMatchObject({ width: 800, height: Math.ceil(desktopLyricsHeight(72, false)) })
    expect(win.webContents.send).toHaveBeenLastCalledWith('overlay:lyrics-state', expect.objectContaining({ fontFamily: 'Songti SC', color: '#ffe29a' }))
    const height = win.bounds.height
    for (let i = 0; i < 20; i++) setLyricsControlBounds({ left: 0, top: 0, right: 28, bottom: 28 })
    expect(win.bounds.height).toBe(height)
  })
  it('三行歌词共用高度，左上角缩放保持右下角且避让屏幕边缘', () => {
    setLyricsEnabled(true, { clickThrough: false, size: 38, translation: '音乐', roma: 'ongaku' })
    const win = harness.instances[0]
    win.bounds = { x: 200, y: 200, width: 420, height: 180 }
    resizeLyrics(500, 210, 'top-left')
    expect(win.bounds).toMatchObject({ x: 120, y: 170, width: 500, height: 210 })
    expect(harness.mainSend).toHaveBeenCalledWith('lyrics:size-changed', { size: desktopLyricsSize(210, true, true) })
    resizeLyrics(10000, 10000, 'top-left')
    expect(win.bounds).toMatchObject({ x: 0, y: 0, width: 620, height: 380 })
    resizeLyrics(10, 10, 'top-left')
    expect(win.bounds.x + win.bounds.width).toBe(620)
    expect(win.bounds.y + win.bounds.height).toBe(380)
    expect(win.bounds.width).toBe(280)
    expect(win.bounds.height).toBe(86)
    updateLyrics({ roma: '' })
    expect(win.bounds.height).toBe(86)
    expect(win.webContents.send).toHaveBeenLastCalledWith('overlay:lyrics-state', expect.objectContaining({ roma: '', size: desktopLyricsSize(86, true) }))
    setLyricsLock(true)
    expect(resizeLyrics(500, 200, 'top-left')).toMatchObject({ ok: false, error: 'DESKTOP_LYRICS_LOCKED' })
  })
  it('左上角扩展使用原屏约束，不被右侧较小屏幕截断', () => {
    setLyricsEnabled(true, { clickThrough: false, size: 38, translation: '', roma: '' })
    const win = harness.instances[0]
    win.bounds = { x: 1500, y: 100, width: 400, height: 200 }
    harness.getDisplayMatching.mockImplementation(bounds => {
      const leftOverlap = Math.max(0, Math.min(1920, bounds.x + bounds.width) - bounds.x)
      const rightOverlap = Math.max(0, Math.min(3200, bounds.x + bounds.width) - Math.max(1920, bounds.x))
      return { workArea: rightOverlap > leftOverlap
        ? { x: 1920, y: 0, width: 1280, height: 1080 }
        : { x: 0, y: 0, width: 1920, height: 1080 } }
    })
    try {
      resizeLyrics(1800, 250, 'top-left')
      expect(win.bounds).toEqual({ x: 100, y: 50, width: 1800, height: 250 })
    } finally {
      harness.getDisplayMatching.mockImplementation(() => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }))
    }
  })
  it('桌面歌词点击和拖动使用不激活应用的窗口，首次点击可直接操作', () => {
    setLyricsEnabled(true, { clickThrough: false })
    const win = harness.instances[0]
    const options = harness.BrowserWindow.mock.calls.at(-1)?.[0]
    expect(options).toMatchObject({ focusable: false, show: false })
    expect(options?.type).toBe(process.platform === 'darwin' ? 'panel' : undefined)
    expect(options?.acceptFirstMouse).toBe(process.platform === 'darwin' ? true : undefined)
    expect(options?.movable).toBe(true)
    expect(preventLyricsActivation).toHaveBeenLastCalledWith(win)
    harness.focusMainWindow.mockClear()
    win.listeners.get('ready-to-show')?.()
    const previous = { ...win.bounds }
    moveLyricsBy(10, 10)
    expect(win.bounds).toMatchObject({ x: previous.x + 10, y: previous.y + 10 })
    resizeLyrics(win.bounds.width + 10, win.bounds.height + 10, 'top-left')
    expect(win.showInactive).toHaveBeenCalledOnce()
    expect(win.show).not.toHaveBeenCalled()
    expect(harness.focusMainWindow).not.toHaveBeenCalled()
  })
})

describe('迷你播放器窗口尺寸', () => {
  beforeEach(() => {
    setMiniPlayerEnabled(false)
    harness.instances.length = 0
    harness.mainSend.mockReset()
    harness.hideMainWindow.mockReset()
    harness.focusMainWindow.mockReset()
  })

  it('移动时保持用户设置的宽度，不吸收平台上报的瞬时宽度漂移', () => {
    setMiniPlayerEnabled(true, 360)
    const win = harness.instances[0]

    win.bounds = { ...win.bounds, width: 361 }
    win.listeners.get('moved')?.()
    moveMiniPlayerBy(12, 8)

    expect(harness.mainSend).not.toHaveBeenCalledWith('miniplayer:width-changed', expect.anything())
    expect(win.setBounds).toHaveBeenLastCalledWith(
      { x: 1548, y: 984, width: 360, height: 80 },
      false
    )
  })

  it('缩放以用户宽度为基准，且非 macOS 不临时开启系统边缘缩放', () => {
    setMiniPlayerEnabled(true, 360)
    const win = harness.instances[0]

    win.bounds = { ...win.bounds, width: 361 }
    resizeMiniPlayerBy(20)

    expect(win.setBounds).toHaveBeenLastCalledWith(
      expect.objectContaining({ width: 380, height: 80 }),
      false
    )
    expect(harness.mainSend).toHaveBeenLastCalledWith('miniplayer:width-changed', { width: 380 })
    if (process.platform !== 'darwin') expect(win.setResizable).not.toHaveBeenCalled()
  })

  it('单次快速拖动也能覆盖完整宽度范围', () => {
    setMiniPlayerEnabled(true, 760)
    const win = harness.instances[0]

    resizeMiniPlayerBy(-1000)

    expect(win.setBounds).toHaveBeenLastCalledWith(
      expect.objectContaining({ width: 300, height: 80 }),
      false
    )
    expect(harness.mainSend).toHaveBeenLastCalledWith('miniplayer:width-changed', { width: 300 })
  })

  it('保留后台节流，避免被遮挡时高频刷新', () => {
    setMiniPlayerEnabled(true, 360)

    expect(harness.BrowserWindow).toHaveBeenLastCalledWith(
      expect.objectContaining({
        webPreferences: expect.objectContaining({ backgroundThrottling: true })
      })
    )
  })

  it('进入迷你模式时窗口可聚焦并接收键盘，旧窗口的 ready 不能抢走焦点', () => {
    setMiniPlayerEnabled(true, 360)
    const first = harness.instances[0]
    expect(harness.BrowserWindow).toHaveBeenLastCalledWith(expect.objectContaining({ focusable: true }))
    first.listeners.get('ready-to-show')?.()
    expect(first.show).toHaveBeenCalledOnce()
    setMiniPlayerEnabled(false)
    setMiniPlayerEnabled(true, 360)
    first.show.mockClear()
    first.listeners.get('ready-to-show')?.()
    expect(first.show).not.toHaveBeenCalled()
  })

  it('退出迷你模式时关闭迷你窗口、同步设置并聚焦主窗口', () => {
    setMiniPlayerEnabled(true, 360)
    const win = harness.instances[0]

    returnFromMiniPlayer()

    expect(win.close).toHaveBeenCalledOnce()
    expect(harness.mainSend).toHaveBeenCalledWith('miniplayer:control', { action: 'sync-off' })
    expect(harness.focusMainWindow).toHaveBeenCalledOnce()
  })

  it('反复启停后可以重新创建迷你窗口', () => {
    setMiniPlayerEnabled(true, 360)
    const first = harness.instances[0]
    setMiniPlayerEnabled(false)
    setMiniPlayerEnabled(true, 360)

    expect(first.close).toHaveBeenCalledOnce()
    expect(harness.instances).toHaveLength(2)
    expect(harness.hideMainWindow).toHaveBeenCalledTimes(2)
  })

  it('进度更新只发送变化字段，不重复复制曲目与外观', () => {
    setMiniPlayerEnabled(true, 360)
    const send = harness.instances[0].webContents.send
    updateMiniPlayer({ trackTitle: '测试歌曲', position: 10, appearance: DEFAULT_MINI_PLAYER_APPEARANCE })
    send.mockClear()

    updateMiniPlayer({ position: 11 })

    expect(send).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith('overlay:miniplayer-state', { position: 11 })
  })

  it('相同状态与值相同的跨桥外观对象不重复发送', () => {
    setMiniPlayerEnabled(true, 360)
    const send = harness.instances[0].webContents.send
    updateMiniPlayer({ position: 20, appearance: DEFAULT_MINI_PLAYER_APPEARANCE })
    send.mockClear()

    updateMiniPlayer({ position: 20, appearance: { ...DEFAULT_MINI_PLAYER_APPEARANCE } })

    expect(send).not.toHaveBeenCalled()
  })

  it('新窗口加载时仍发送完整快照', () => {
    updateMiniPlayer({ trackTitle: '重新打开', position: 30, appearance: DEFAULT_MINI_PLAYER_APPEARANCE })
    setMiniPlayerEnabled(true, 360)
    const webContents = harness.instances[0].webContents
    const onLoad = webContents.once.mock.calls.find(([event]) => event === 'did-finish-load')?.[1]

    onLoad()

    expect(webContents.send).toHaveBeenLastCalledWith('overlay:miniplayer-state', expect.objectContaining({
      trackTitle: '重新打开', position: 30, appearance: DEFAULT_MINI_PLAYER_APPEARANCE
    }))
  })
})
