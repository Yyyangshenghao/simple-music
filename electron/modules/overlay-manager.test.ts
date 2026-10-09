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
    webContents: { send: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn>; once: ReturnType<typeof vi.fn>; getZoomFactor: ReturnType<typeof vi.fn> }
  }> = []
  const mainSend = vi.fn()
  const hideMainWindow = vi.fn()
  const focusMainWindow = vi.fn()
  const cursor = { x: -100, y: -100 }
  const getDisplayMatching = vi.fn((_bounds: Electron.Rectangle) => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }))
  const getDisplayNearestPoint = vi.fn((_point: Electron.Point) => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }))

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

  return { BrowserWindow, instances, mainSend, hideMainWindow, focusMainWindow, cursor, getDisplayMatching, getDisplayNearestPoint }
})

vi.mock('electron', () => ({
  BrowserWindow: harness.BrowserWindow,
  screen: {
    getCursorScreenPoint: () => harness.cursor,
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    getDisplayMatching: harness.getDisplayMatching,
    getDisplayNearestPoint: harness.getDisplayNearestPoint
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
const backdrop = vi.hoisted(() => ({ update: vi.fn(() => true), dispose: vi.fn() }))
vi.mock('./lyrics-native-backdrop', () => ({ createLyricsNativeBackdrop: vi.fn(() => backdrop) }))
vi.mock('./macos-lyrics-window', () => ({ preventLyricsActivation: vi.fn(() => true) }))
vi.mock('../platform', () => ({
  getPlatform: () => ({
    startMousePoller: vi.fn(),
    stopMousePoller: vi.fn(),
    attachWallpaperToDesktop: vi.fn(),
    ensureDesktopShortcut: vi.fn()
  })
}))

import { moveMiniPlayerBy, resizeMiniPlayerBy, returnFromMiniPlayer, hideMiniPlayerToTray, setMiniPlayerPopover, setMiniPlayerEnabled, updateMiniPlayer, setLyricsEnabled, updateLyrics, moveLyricsBy, resizeLyrics, setLyricsLock, setLyricsPointerCapture, setLyricsControlBounds, closeOverlays } from './overlay-manager'
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
    expect(win.bounds.height).toBe(96)
    expect(win.bounds.width).toBe(680)
    if (process.platform === 'darwin') {
      expect(win.setResizable).toHaveBeenCalledWith(true)
      expect(win.setResizable).toHaveBeenLastCalledWith(false)
    } else expect(win.setResizable).not.toHaveBeenCalled()
    expect(win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false, { forward: true })
    updateLyrics({ opacity: 0.5 })
    expect(win.setOpacity).not.toHaveBeenCalled()
    expect(win.webContents.send).toHaveBeenLastCalledWith('overlay:lyrics-state', expect.objectContaining({ opacity: 0.5 }))
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
  it.each([
    { widthInset: 1, heightInset: 0 },
    { widthInset: 16, heightInset: 8 }
  ])('系统读回宽度偏大 $widthInset 时，拖动不反复累加尺寸偏差', ({ widthInset, heightInset }) => {
    setLyricsEnabled(true, { clickThrough: false, size: 38, autoWidth: false, translation: '', roma: '', nextLine: '' })
    const win = harness.instances[0]
    resizeLyrics(680, 90)
    win.bounds = { ...win.bounds, x: 200, y: 200 }
    win.setBounds.mockClear()
    // 模拟系统读回宽高偏大；热区上报、移动、设置更新都不能放大偏差。
    win.setBounds.mockImplementation((bounds: Electron.Rectangle) => {
      win.bounds = { ...bounds, width: bounds.width + widthInset, height: bounds.height + heightInset }
    })
    try {
      for (let i = 0; i < 20; i++) {
        moveLyricsBy(10, 5)
        setLyricsControlBounds({ left: 0, top: 0, right: 28, bottom: 28 })
      }
      expect(win.bounds).toEqual({ x: 400, y: 300, width: 680 + widthInset, height: 90 + heightInset })
      expect(win.setBounds).toHaveBeenCalledTimes(20)
      for (const [bounds] of win.setBounds.mock.calls) expect(bounds).toMatchObject({ width: 680, height: 90 })
      updateLyrics({ size: 48 })
      expect(win.setBounds).toHaveBeenLastCalledWith(expect.objectContaining({ width: 680, height: Math.ceil(desktopLyricsHeight(48, false)) }), false)
      setLyricsEnabled(false)
      setLyricsEnabled(true, { clickThrough: false, size: 38 })
      expect(harness.instances.at(-1)!.bounds.width).toBe(680)
    } finally {
      win.setBounds.mockImplementation((bounds: Electron.Rectangle) => { win.bounds = { ...bounds } })
    }
  })
  it.each([
    { fromX: 1240, cursorX: 1930, dx: 160, expectedX: 1920 },
    { fromX: 1920, cursorX: 1910, dx: -160, expectedX: 1240 }
  ])('拖动时光标跨屏可将宽歌词窗口移到相邻显示器（$dx）', ({ fromX, cursorX, dx, expectedX }) => {
    const areas = [
      { x: 0, y: 0, width: 1920, height: 1080 },
      { x: 1920, y: 0, width: 1920, height: 1080 }
    ]
    harness.getDisplayMatching.mockImplementation(bounds => ({
      workArea: areas.reduce((best, area) => {
        const overlap = (rect: Electron.Rectangle) => Math.max(0, Math.min(rect.x + rect.width, bounds.x + bounds.width) - Math.max(rect.x, bounds.x))
        return overlap(area) > overlap(best) ? area : best
      })
    }))
    harness.getDisplayNearestPoint.mockImplementation(point => ({ workArea: areas[point.x >= 1920 ? 1 : 0] }))
    try {
      setLyricsEnabled(true, { clickThrough: false, size: 38, autoWidth: false })
      const win = harness.instances[0]
      resizeLyrics(680, 90)
      win.bounds = { x: fromX, y: 100, width: 680, height: 90 }
      Object.assign(harness.cursor, { x: cursorX, y: 145 })
      moveLyricsBy(dx, 0)
      expect(win.bounds).toEqual({ x: expectedX, y: 100, width: 680, height: 90 })
    } finally {
      harness.getDisplayMatching.mockImplementation(() => ({ workArea: areas[0] }))
      harness.getDisplayNearestPoint.mockImplementation(() => ({ workArea: areas[0] }))
    }
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
    expect(win.bounds.height).toBe(Math.ceil(desktopLyricsHeight(48, true) * 1.25))
    expect(win.bounds.width).toBe(680)
    expect(Math.abs(win.bounds.y + win.bounds.height / 2 - centerY)).toBeLessThanOrEqual(0.5)
    win.webContents.getZoomFactor.mockReturnValue(1)
    setLyricsControlBounds({ left: 300, top: 8, right: 328, bottom: 36 })
    expect(win.bounds.height).toBe(Math.ceil(desktopLyricsHeight(48, true)))
  })
  it('原生毛玻璃常态显示，锁定与移出不隐藏，样式和透明度独立生效并随关闭释放', () => {
    backdrop.update.mockClear()
    backdrop.dispose.mockClear()
    setLyricsEnabled(true, { clickThrough: false, backgroundStyle: 'frosted', backgroundOpacity: 0.3 })
    expect(backdrop.update).toHaveBeenLastCalledWith({ visible: true, opacity: 0.3 })
    setLyricsPointerCapture(false)
    expect(backdrop.update).toHaveBeenLastCalledWith({ visible: true, opacity: 0.3 })
    setLyricsPointerCapture(true)
    expect(backdrop.update).toHaveBeenLastCalledWith({ visible: true, opacity: 0.3 })
    setLyricsLock(true)
    expect(backdrop.update).toHaveBeenLastCalledWith({ visible: true, opacity: 0.3 })
    setLyricsLock(false)
    setLyricsPointerCapture(true)
    updateLyrics({ backgroundStyle: 'dark' })
    expect(backdrop.update).toHaveBeenLastCalledWith({ visible: false, opacity: 0.3 })
    setLyricsEnabled(false)
    expect(backdrop.dispose).toHaveBeenCalledOnce()
  })
  it('原生底框更新失败时回退暗灰，设置页锁定仍保留常态底框', () => {
    setLyricsEnabled(true, { clickThrough: false, backgroundStyle: 'frosted' })
    const win = harness.instances[0]
    setLyricsPointerCapture(true)
    updateLyrics({ clickThrough: true })
    expect(backdrop.update).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }))
    updateLyrics({ clickThrough: false })
    expect(backdrop.update).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }))
    backdrop.update.mockReturnValueOnce(false)
    updateLyrics({ backgroundOpacity: 0.2 })
    expect(win.webContents.send).toHaveBeenLastCalledWith('overlay:lyrics-state', expect.objectContaining({ nativeGlass: false }))
  })
  it('逐字时钟推送不调整窗口尺寸或鼠标穿透状态', () => {
    setLyricsEnabled(true, { clickThrough: false })
    const win = harness.instances[0]
    win.setBounds.mockClear()
    win.setIgnoreMouseEvents.mockClear()
    updateLyrics({ wordClock: { elapsedMs: 500, playing: true, rate: 1 } })
    expect(win.setBounds).not.toHaveBeenCalled()
    expect(win.setIgnoreMouseEvents).not.toHaveBeenCalled()
    expect(win.webContents.send).toHaveBeenLastCalledWith('overlay:lyrics-state', expect.objectContaining({ wordClock: { elapsedMs: 500, playing: true, rate: 1 } }))
  })
  it('双行切换按两个原文行调整高度，用户缩放后保留字号', () => {
    setLyricsEnabled(true, { clickThrough: false, size: 38, translation: '', roma: '', nextLine: '' })
    const win = harness.instances[0]
    updateLyrics({ nextLine: '下一句' })
    expect(win.bounds.height).toBe(Math.ceil(desktopLyricsHeight(38, false, false, true)))
    resizeLyrics(500, 200)
    expect(harness.mainSend).toHaveBeenCalledWith('lyrics:size-changed', { size: desktopLyricsSize(200, false, false, true) })
    updateLyrics({ nextLine: '' })
    const size = desktopLyricsSize(200, false, false, true)
    expect(win.bounds.height).toBe(Math.ceil(desktopLyricsHeight(size, false)))
    expect(win.webContents.send).toHaveBeenLastCalledWith('overlay:lyrics-state', expect.objectContaining({ size }))
  })
  it('切歌清空和恢复附加歌词不改写用户字号，重复更新不产生取整漂移', () => {
    setLyricsEnabled(true, { clickThrough: false, size: 38, translation: '译文', roma: '音译', nextLine: '下一句' })
    const win = harness.instances[0]
    resizeLyrics(500, 250)
    const size = desktopLyricsSize(250, true, true, true)
    harness.mainSend.mockClear()
    for (let i = 0; i < 3; i++) {
      updateLyrics({ line: '加载中', translation: '', roma: '', nextLine: '' })
      expect(win.bounds.height).toBe(Math.ceil(desktopLyricsHeight(size, false)))
      updateLyrics({ line: '新歌', translation: '新译文', roma: '新音译', nextLine: '下一句' })
      setLyricsControlBounds({ left: 0, top: 0, right: 28, bottom: 28 })
      expect(win.webContents.send).toHaveBeenLastCalledWith('overlay:lyrics-state', expect.objectContaining({ size }))
    }
    expect(harness.mainSend).not.toHaveBeenCalledWith('lyrics:size-changed', expect.anything())
  })
  it('非整数设置字号在反复切歌时保持原值', () => {
    setLyricsEnabled(true, { clickThrough: false, size: 38.25, translation: '', roma: '', nextLine: '' })
    const win = harness.instances[0]
    resizeLyrics(800, win.bounds.height)
    expect(win.webContents.send).toHaveBeenLastCalledWith('overlay:lyrics-state', expect.objectContaining({ size: 38.25 }))
    for (let i = 0; i < 3; i++) {
      updateLyrics({ line: '新歌词', translation: '译文' })
      updateLyrics({ translation: '' })
      expect(win.webContents.send).toHaveBeenLastCalledWith('overlay:lyrics-state', expect.objectContaining({ size: 38.25 }))
    }
  })
  it('自适应按文字宽度伸缩，保持中心与字号，关闭恢复手动宽度', () => {
    setLyricsEnabled(true, { clickThrough: false, size: 38, autoWidth: false, translation: '', roma: '', nextLine: '' })
    const win = harness.instances[0]
    resizeLyrics(500, 160)
    const size = desktopLyricsSize(160, false)
    const center = win.bounds.x + win.bounds.width / 2
    updateLyrics({ autoWidth: true })
    harness.mainSend.mockClear()
    setLyricsControlBounds({ left: 0, top: 0, right: 28, bottom: 28, contentWidth: 250 })
    expect(win.bounds.width).toBe(392)
    expect(win.bounds.x + win.bounds.width / 2).toBe(center)
    setLyricsControlBounds({ left: 0, top: 0, right: 28, bottom: 28, contentWidth: 30 })
    expect(win.bounds.width).toBe(180)
    updateLyrics({ autoWidth: false })
    expect(win.bounds.width).toBe(500)
    setLyricsControlBounds({ left: 0, top: 0, right: 28, bottom: 28, contentWidth: 1000 })
    expect(win.bounds.width).toBe(500)
    expect(harness.mainSend).not.toHaveBeenCalledWith('lyrics:size-changed', expect.anything())
    expect(win.webContents.send).toHaveBeenLastCalledWith('overlay:lyrics-state', expect.objectContaining({ size }))
  })
  it('关闭桌面歌词期间关闭自适应，重开仍恢复此前手动宽度', () => {
    setLyricsEnabled(true, { clickThrough: false, size: 38, autoWidth: false, translation: '', roma: '', nextLine: '' })
    resizeLyrics(500, 160)
    updateLyrics({ autoWidth: true })
    setLyricsControlBounds({ left: 0, top: 0, right: 28, bottom: 28, contentWidth: 250 })
    setLyricsEnabled(false)
    setLyricsEnabled(true, { clickThrough: false, autoWidth: false })
    expect(harness.instances[1].bounds.width).toBe(500)
  })
  it('自适应宽度计入页面缩放且上限为当前显示器，不接受无效测量', () => {
    setLyricsEnabled(true, { clickThrough: true, size: 38, autoWidth: true, translation: '', roma: '', nextLine: '' })
    const win = harness.instances[0]
    win.webContents.getZoomFactor.mockReturnValue(1.25)
    setLyricsControlBounds({ left: 0, top: 0, right: 28, bottom: 28, contentWidth: 250 })
    expect(win.bounds.width).toBe(490)
    setLyricsControlBounds({ left: 0, top: 0, right: 28, bottom: 28, contentWidth: 5000 })
    expect(win.bounds).toMatchObject({ width: 1920, x: 0 })
    for (const contentWidth of [NaN, Infinity, -10, 0]) {
      setLyricsControlBounds({ left: 0, top: 0, right: 28, bottom: 28, contentWidth })
      expect(win.bounds.width).toBe(1920)
    }
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
    expect(next.bounds).toMatchObject({ width: 420, height: Math.ceil(desktopLyricsHeight(desktopLyricsSize(90, false), true)) })
    resizeLyrics(-100, -100)
    expect(next.bounds).toMatchObject({ width: 280, height: 76 })
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
    resizeLyrics(420, 180)
    win.bounds = { ...win.bounds, x: 200, y: 200 }
    resizeLyrics(500, 210, 'top-left')
    expect(win.bounds).toMatchObject({ x: 120, y: 170, width: 500, height: 210 })
    expect(harness.mainSend).toHaveBeenCalledWith('lyrics:size-changed', { size: desktopLyricsSize(210, true, true) })
    resizeLyrics(10000, 10000, 'top-left')
    expect(win.bounds).toMatchObject({ x: 0, y: 0, width: 620, height: 380 })
    resizeLyrics(10, 10, 'top-left')
    expect(win.bounds.x + win.bounds.width).toBe(620)
    expect(win.bounds.y + win.bounds.height).toBe(380)
    expect(win.bounds.width).toBe(280)
    expect(win.bounds.height).toBe(89)
    updateLyrics({ roma: '' })
    const size = desktopLyricsSize(89, true, true)
    expect(win.bounds.height).toBe(Math.ceil(desktopLyricsHeight(size, true)))
    expect(win.webContents.send).toHaveBeenLastCalledWith('overlay:lyrics-state', expect.objectContaining({ roma: '', size }))
    setLyricsLock(true)
    expect(resizeLyrics(500, 200, 'top-left')).toMatchObject({ ok: false, error: 'DESKTOP_LYRICS_LOCKED' })
  })
  it('左上角扩展使用原屏约束，不被右侧较小屏幕截断', () => {
    setLyricsEnabled(true, { clickThrough: false, size: 38, translation: '', roma: '' })
    const win = harness.instances[0]
    resizeLyrics(400, 200)
    win.bounds = { ...win.bounds, x: 1500, y: 100 }
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

  it('系统关闭当前迷你窗时恢复主窗口、同步开关并清理弹层高度', () => {
    setMiniPlayerEnabled(true, 360)
    const win = harness.instances[0]
    setMiniPlayerPopover(true)
    win.listeners.get('closed')?.()
    expect(harness.mainSend).toHaveBeenCalledWith('miniplayer:control', { action: 'sync-off' })
    expect(harness.focusMainWindow).toHaveBeenCalledOnce()
    expect(win.close).not.toHaveBeenCalled()
    setMiniPlayerEnabled(true, 360)
    expect(harness.instances[1].bounds.height).toBe(80)
  })

  it.each(['系统关闭', '显式返回'] as const)('音量弹层展开后%s，再次打开及反复开关保持底边', (path) => {
    setMiniPlayerEnabled(true, 360)
    let win = harness.instances[0]
    const original = { ...win.bounds }
    for (let index = 0; index < 3; index++) {
      setMiniPlayerPopover(true)
      expect(win.bounds.y + win.bounds.height).toBe(original.y + original.height)
      if (path === '系统关闭') win.listeners.get('closed')?.()
      else returnFromMiniPlayer()
      setMiniPlayerEnabled(true, 360)
      win = harness.instances.at(-1)!
      expect(win.bounds).toEqual(original)
    }
  })

  it.each([
    { label: '返回主窗口', close: returnFromMiniPlayer, focusCount: 1, syncOff: true },
    { label: '退居托盘', close: hideMiniPlayerToTray, focusCount: 0, syncOff: true },
    { label: '应用退出', close: closeOverlays, focusCount: 0, syncOff: false }
  ])('显式$label 不被同步或延迟的 closed 事件重复恢复窗口', ({ close, focusCount, syncOff }) => {
    setMiniPlayerEnabled(true, 360)
    const first = harness.instances[0]
    first.close.mockImplementation(() => first.listeners.get('closed')?.())
    close()
    expect(harness.focusMainWindow).toHaveBeenCalledTimes(focusCount)
    const notifications = () => harness.mainSend.mock.calls.filter(([channel]) => channel === 'miniplayer:control')
    expect(notifications()).toHaveLength(Number(syncOff))
    setMiniPlayerEnabled(true, 360)
    first.listeners.get('closed')?.()
    expect(harness.focusMainWindow).toHaveBeenCalledTimes(focusCount)
    expect(notifications()).toHaveLength(Number(syncOff))
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
    const onLoad = webContents.on.mock.calls.find(([event]) => event === 'did-finish-load')?.[1]

    onLoad()

    expect(webContents.send).toHaveBeenLastCalledWith('overlay:miniplayer-state', expect.objectContaining({
      trackTitle: '重新打开', position: 30, appearance: DEFAULT_MINI_PLAYER_APPEARANCE
    }))
  })

  it('迷你页刷新后重放完整快照，保留未变化的曲目信息和返回快捷键', () => {
    updateMiniPlayer({ trackTitle: '刷新测试', position: 30, returnShortcut: 'Command+Shift+P', appearance: DEFAULT_MINI_PLAYER_APPEARANCE })
    setMiniPlayerEnabled(true, 360)
    const webContents = harness.instances[0].webContents
    const finishLoad = () => {
      for (const [event, callback] of [...webContents.on.mock.calls, ...webContents.once.mock.calls]) {
        if (event === 'did-finish-load') callback()
      }
      webContents.once.mockClear()
    }
    finishLoad()
    updateMiniPlayer({ position: 31 })
    webContents.send.mockClear()
    finishLoad()
    expect(webContents.send).toHaveBeenLastCalledWith('overlay:miniplayer-state', expect.objectContaining({
      trackTitle: '刷新测试', position: 31, returnShortcut: 'Command+Shift+P', appearance: DEFAULT_MINI_PLAYER_APPEARANCE
    }))
  })
  it.each([
    { fromX: 1420, cursorX: 1930, dx: 12, expectedX: 1920 },
    { fromX: 1920, cursorX: 1910, dx: -12, expectedX: 1420 },
    { fromX: 0, cursorX: -10, dx: -12, expectedX: -500 },
    { fromX: -500, cursorX: 10, dx: 12, expectedX: 0 },
    { fromX: 1420, cursorX: 1930, dx: 12, expectedX: 1920, popover: true }
  ])('普通拖动跟随光标跨屏并支持负坐标（$fromX → $expectedX）', ({ fromX, cursorX, dx, expectedX, popover = false }) => {
    const areas = [
      { x: -1920, y: 0, width: 1920, height: 1080 },
      { x: 0, y: 0, width: 1920, height: 1080 },
      { x: 1920, y: 0, width: 1920, height: 1080 }
    ]
    harness.getDisplayMatching.mockImplementation(bounds => ({
      workArea: areas.reduce((best, area) => {
        const overlap = (rect: Electron.Rectangle) => Math.max(0, Math.min(rect.x + rect.width, bounds.x + bounds.width) - Math.max(rect.x, bounds.x))
        return overlap(area) > overlap(best) ? area : best
      })
    }))
    harness.getDisplayNearestPoint.mockImplementation(point => ({ workArea: areas[point.x < 0 ? 0 : point.x >= 1920 ? 2 : 1] }))
    try {
      setMiniPlayerEnabled(true, 500)
      const win = harness.instances[0]
      win.bounds = { x: fromX, y: 100, width: 500, height: 80 }
      if (popover) setMiniPlayerPopover(true)
      Object.assign(harness.cursor, { x: cursorX, y: 140 })

      moveMiniPlayerBy(dx, 0)

      expect(win.bounds).toEqual({ x: expectedX, y: popover ? 44 : 100, width: 500, height: popover ? 136 : 80 })
      expect(harness.mainSend).not.toHaveBeenCalledWith('miniplayer:width-changed', expect.anything())
    } finally {
      harness.getDisplayMatching.mockImplementation(() => ({ workArea: areas[1] }))
      harness.getDisplayNearestPoint.mockImplementation(() => ({ workArea: areas[1] }))
      setMiniPlayerPopover(false)
    }
  })

  it('缩放和展开弹层仍按窗口所在屏约束，不跟随另一屏的光标', () => {
    setMiniPlayerEnabled(true, 500)
    const win = harness.instances[0]
    win.bounds = { x: 1000, y: 300, width: 500, height: 80 }
    harness.getDisplayNearestPoint.mockImplementation(() => ({ workArea: { x: -1920, y: 0, width: 1920, height: 1080 } }))
    try {
      resizeMiniPlayerBy(12)
      expect(win.bounds).toEqual({ x: 1000, y: 300, width: 512, height: 80 })
      setMiniPlayerPopover(true)
      expect(win.bounds).toEqual({ x: 1000, y: 244, width: 512, height: 136 })
    } finally {
      harness.getDisplayNearestPoint.mockImplementation(() => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }))
      setMiniPlayerPopover(false)
    }
  })
})
