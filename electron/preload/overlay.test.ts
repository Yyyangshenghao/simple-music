import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopOverlayApi } from './overlay'
import { DEFAULT_MINI_PLAYER_APPEARANCE } from '../../src/lib/mini-player-config'

const harness = vi.hoisted(() => ({ expose: vi.fn(), on: vi.fn(), removeListener: vi.fn(), invoke: vi.fn() }))
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: harness.expose },
  ipcRenderer: { on: harness.on, removeListener: harness.removeListener, invoke: harness.invoke }
}))

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
