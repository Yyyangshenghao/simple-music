import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVisualStore } from '../stores/visual'
import { useGameModeStore } from '../stores/game-mode'
import type { WallpaperPayload } from '../types/ipc'
import { initWallpaperSync } from './wallpaper-sync'

const updateWallpaper = vi.fn(async (_payload: WallpaperPayload) => ({ ok: true }))
const setWallpaperEnabled = vi.fn()
const initialVisual = useVisualStore.getState()
let stop: (() => void) | undefined
beforeEach(() => {
  vi.useFakeTimers()
  updateWallpaper.mockReset().mockResolvedValue({ ok: true })
  setWallpaperEnabled.mockClear()
  useVisualStore.setState(initialVisual)
  useGameModeStore.setState({ enabled: false, initialized: false, sequence: 0 })
  vi.stubGlobal('window', { desktop: { updateWallpaper, setWallpaperEnabled } })
})
afterEach(() => {
  stop?.()
  stop = undefined
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('宿主持有壁纸参数同步', () => {
  it('首次发送完整快照，重复启动不重复订阅，只有fx变化才更新', () => {
    stop = initWallpaperSync()
    expect(updateWallpaper).toHaveBeenCalledOnce()
    expect(updateWallpaper).toHaveBeenLastCalledWith(useVisualStore.getState().fx)
    expect(updateWallpaper.mock.lastCall![0]).not.toBe(useVisualStore.getState().fx)
    expect(initWallpaperSync()).toBe(stop)
    useVisualStore.getState().setPerformanceMode('eco')
    expect(updateWallpaper).toHaveBeenCalledOnce()
    useVisualStore.getState().updateFx({ speed: 0.75 })
    expect(updateWallpaper).toHaveBeenCalledTimes(2)
    expect(updateWallpaper).toHaveBeenLastCalledWith(useVisualStore.getState().fx)
    expect(setWallpaperEnabled).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('游戏中不推送，退出补最新完整参数，重复确认和快速进退仍能重放', () => {
    useGameModeStore.getState().setState({ enabled: true })
    stop = initWallpaperSync()
    useVisualStore.getState().updateFx({ speed: 0.5 })
    useVisualStore.getState().updateFx({ bloom: false })
    useGameModeStore.getState().setState({ enabled: true })
    expect(updateWallpaper).not.toHaveBeenCalled()
    useGameModeStore.getState().setState({ enabled: false })
    expect(updateWallpaper).toHaveBeenCalledOnce()
    expect(updateWallpaper).toHaveBeenLastCalledWith(useVisualStore.getState().fx)
    expect(updateWallpaper.mock.lastCall![0]).toMatchObject({ speed: 0.5, bloom: false })
    useGameModeStore.getState().setState({ enabled: false })
    expect(updateWallpaper).toHaveBeenCalledTimes(2)
    useGameModeStore.getState().setState({ enabled: true })
    useVisualStore.getState().updateFx({ speed: 0.9 })
    expect(updateWallpaper).toHaveBeenCalledTimes(2)
    useGameModeStore.getState().setState({ enabled: false })
    expect(updateWallpaper).toHaveBeenCalledTimes(3)
    expect(updateWallpaper.mock.lastCall![0]).toMatchObject({ speed: 0.9, bloom: false })
    expect(setWallpaperEnabled).not.toHaveBeenCalled()
  })

  it('停止幂等，后续参数和模式事件不推送，迟到失败被接住且不关闭窗口', async () => {
    let reject!: (error: Error) => void
    updateWallpaper.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail }))
    stop = initWallpaperSync()
    stop()
    stop()
    useVisualStore.getState().updateFx({ speed: 0.25 })
    useGameModeStore.getState().setState({ enabled: true })
    useGameModeStore.getState().setState({ enabled: false })
    reject(new Error('旧IPC失败'))
    await Promise.resolve()
    expect(updateWallpaper).toHaveBeenCalledOnce()
    expect(setWallpaperEnabled).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('无桌面桥时安全跳过，桥可用后仍能正常启动', () => {
    vi.stubGlobal('window', {})
    initWallpaperSync()()
    vi.stubGlobal('window', { desktop: { updateWallpaper } })
    stop = initWallpaperSync()
    expect(updateWallpaper).toHaveBeenCalledOnce()
  })
})
