import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopOverlayApi } from './overlay'
import { DEFAULT_MINI_PLAYER_APPEARANCE } from '../../src/lib/mini-player-config'

const harness = vi.hoisted(() => ({ expose: vi.fn(), on: vi.fn(), removeListener: vi.fn(), invoke: vi.fn() }))
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: harness.expose },
  ipcRenderer: { on: harness.on, removeListener: harness.removeListener, invoke: harness.invoke }
}))

describe('桌面歌词 preload 首屏状态重放', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('左上角缩放锚点透传主进程，旧调用保持兼容', async () => {
    await import('./overlay')
    const api = harness.expose.mock.calls[0][1] as DesktopOverlayApi

    api.resizeLyrics(500, 120, 'top-left')
    expect(harness.invoke).toHaveBeenLastCalledWith('overlay:lyrics-resize', { width: 500, height: 120, anchor: 'top-left' })
    api.resizeLyrics(500, 120)
    expect(harness.invoke).toHaveBeenLastCalledWith('overlay:lyrics-resize', { width: 500, height: 120 })
  })

  it('歌词快照早于页面订阅时仍可重放，增量更新保留字号与锁定状态', async () => {
    await import('./overlay')
    const api = harness.expose.mock.calls[0][1] as DesktopOverlayApi
    const receive = harness.on.mock.calls.find(([channel]) => channel === 'overlay:lyrics-state')?.[1]
    receive({}, { line: '首句歌词', size: 38, clickThrough: false, translation: '翻译' })
    receive({}, { line: '下一句歌词' })
    const callback = vi.fn()

    api.onLyricsState(callback)

    expect(callback).toHaveBeenCalledWith({ line: '下一句歌词', size: 38, clickThrough: false, translation: '翻译' })
    receive({}, { clickThrough: true })
    expect(callback).toHaveBeenLastCalledWith({ line: '下一句歌词', size: 38, clickThrough: true, translation: '翻译' })
  })

  it('取消订阅后不再通知，重新订阅时重放关闭翻译后的最新状态', async () => {
    await import('./overlay')
    const api = harness.expose.mock.calls[0][1] as DesktopOverlayApi
    const receive = harness.on.mock.calls.find(([channel]) => channel === 'overlay:lyrics-state')?.[1]
    const callback = vi.fn()
    const stop = api.onLyricsState(callback)
    receive({}, { line: '歌词', translation: '翻译' })
    stop()
    callback.mockClear()
    receive({}, { translation: '' })
    expect(callback).not.toHaveBeenCalled()

    api.onLyricsState(callback)

    expect(callback).toHaveBeenCalledOnce()
    expect(callback).toHaveBeenCalledWith({ line: '歌词', translation: '' })
    expect(harness.on.mock.calls.filter(([channel]) => channel === 'overlay:lyrics-state')).toHaveLength(1)
  })
})

describe('迷你条 preload 首屏状态重放', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('完整快照早于 React 订阅时，订阅者仍收到最新完整状态', async () => {
    await import('./overlay')
    const api = harness.expose.mock.calls[0][1] as DesktopOverlayApi
    const receive = harness.on.mock.calls.find(([channel]) => channel === 'overlay:miniplayer-state')?.[1]
    expect(receive).toBeTypeOf('function')
    receive({}, { trackTitle: '首屏歌曲', position: 10, appearance: DEFAULT_MINI_PLAYER_APPEARANCE })
    receive({}, { position: 11 })
    const callback = vi.fn()

    api.onMiniPlayerState(callback)

    expect(callback).toHaveBeenCalledWith({ trackTitle: '首屏歌曲', position: 11, appearance: DEFAULT_MINI_PLAYER_APPEARANCE })
  })

  it('订阅后只回调增量，取消订阅后不再回调，重新订阅可重放', async () => {
    await import('./overlay')
    const api = harness.expose.mock.calls[0][1] as DesktopOverlayApi
    const receive = harness.on.mock.calls.find(([channel]) => channel === 'overlay:miniplayer-state')?.[1]
    const callback = vi.fn()
    const stop = api.onMiniPlayerState(callback)
    receive({}, { trackTitle: '标题' })
    receive({}, { position: 12 })
    expect(callback).toHaveBeenLastCalledWith({ position: 12 })
    stop()
    callback.mockClear()
    receive({}, { position: 13 })
    expect(callback).not.toHaveBeenCalled()

    api.onMiniPlayerState(callback)
    expect(callback).toHaveBeenCalledOnce()
    expect(callback).toHaveBeenCalledWith({ trackTitle: '标题', position: 13 })
    expect(harness.on.mock.calls.filter(([channel]) => channel === 'overlay:miniplayer-state')).toHaveLength(1)
  })
})

describe('动态壁纸 preload 首屏状态重放', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('完整快照早于页面订阅时仍可重放，增量保留原有视觉参数', async () => {
    await import('./overlay')
    const api = harness.expose.mock.calls[0][1] as DesktopOverlayApi
    const receive = harness.on.mock.calls.find(([channel]) => channel === 'overlay:wallpaper-state')?.[1]
    expect(receive).toBeTypeOf('function')
    receive({}, { enabled: true, scene: 'stars', exposure: 1.2 })
    receive({}, { exposure: 1.5 })
    const callback = vi.fn()

    api.onWallpaperState(callback)

    expect(callback).toHaveBeenCalledOnce()
    expect(callback).toHaveBeenCalledWith({ enabled: true, scene: 'stars', exposure: 1.5 })
    receive({}, { enabled: false })
    expect(callback).toHaveBeenLastCalledWith({ enabled: false, scene: 'stars', exposure: 1.5 })
  })

  it('取消订阅后不再通知，重新订阅时重放最新状态', async () => {
    await import('./overlay')
    const api = harness.expose.mock.calls[0][1] as DesktopOverlayApi
    const callback = vi.fn()
    const stop = api.onWallpaperState(callback)
    expect(callback).not.toHaveBeenCalled()
    const receive = harness.on.mock.calls.find(([channel]) => channel === 'overlay:wallpaper-state')?.[1]
    receive({}, { enabled: true, exposure: 1.2 })
    stop()
    callback.mockClear()
    receive({}, { enabled: false })
    expect(callback).not.toHaveBeenCalled()

    api.onWallpaperState(callback)

    expect(callback).toHaveBeenCalledOnce()
    expect(callback).toHaveBeenCalledWith({ enabled: false, exposure: 1.2 })
    expect(harness.on.mock.calls.filter(([channel]) => channel === 'overlay:wallpaper-state')).toHaveLength(1)
  })
})
