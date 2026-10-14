import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStore } from 'zustand/vanilla'

const h = vi.hoisted(() => ({
  stores: {} as Record<string, import('zustand').StoreApi<Record<string, unknown>>>,
  startRuntime: vi.fn(() => vi.fn()), publish: vi.fn(), capture: vi.fn(async () => true),
  stopSpectrum: vi.fn(), startSpectrum: vi.fn(), spectrumRequested: vi.fn(),
}))
vi.mock('./playback-shared-stores', () => ({
  playbackStores: h.stores,
  remoteActions: { player: ['loadTrack', 'pause'], downloads: ['saveMany'], apple: ['refresh'] },
}))
vi.mock('./playback-runtime', () => ({ startPlaybackRuntime: h.startRuntime }))
vi.mock('./provider-account-session', () => ({ providerAccountSession: () => 2 }))
vi.mock('../stores/player', () => ({ usePlayerStore: { getState: () => h.stores.player.getState() } }))
vi.mock('../stores/game-mode', () => ({ useGameModeStore: {
  getState: () => ({ enabled: false }), subscribe: () => () => {},
} }))
vi.mock('./apple-audio-spectrum', () => ({ appleAudioSpectrum: { start: h.startSpectrum, stop: h.stopSpectrum } }))
vi.mock('./playback-host-observation', () => ({ setPlaybackSpectrumRequested: h.spectrumRequested, setPlaybackShortcutBlocked: vi.fn() }))

let stop: (() => void) | undefined
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.stubGlobal('performance', { now: () => Date.now() })
  vi.stubGlobal('crypto', { randomUUID: () => 'host-session' })
  vi.stubGlobal('window', {
    desktop: { publishPlayback: h.publish, startAppleAudioCapture: h.capture },
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })
  h.stores.player = createStore<Record<string, unknown>>(() => ({
    status: 'paused', position: 0, currentTrack: null, playbackTransport: 'local',
    pause: vi.fn(), loadTrack: vi.fn(), _frequencyData: () => new Uint8Array([1, 2]),
  }))
  h.stores.downloads = createStore<Record<string, unknown>>(() => ({ jobs: [], saveMany: vi.fn() }))
})
afterEach(() => { stop?.(); stop = undefined; vi.useRealTimers(); vi.unstubAllGlobals() })

describe('独立播放宿主', () => {
  it('慢加载未完成时仍立即受理暂停命令', async () => {
    let finish!: () => void
    h.stores.player.setState({ loadTrack: () => new Promise<void>(resolve => { finish = resolve }) })
    const host = await import('./playback-host-runtime')
    stop = host.startPlaybackHost()
    const loading = host.handlePlaybackRequest({ type: 'action', store: 'player', action: 'loadTrack', args: [] })
    await host.handlePlaybackRequest({ type: 'action', store: 'player', action: 'pause', args: [] })
    expect(h.stores.player.getState().pause).toHaveBeenCalledOnce()
    finish()
    await loading
  })

  it('快照剥除函数和下载控制器，进度更新不重传队列', async () => {
    h.stores.downloads.setState({ jobs: [{ track: { id: 1 }, controller: new AbortController(), status: 'saving' }] })
    h.stores.playlist = createStore<Record<string, unknown>>(() => ({ queue: [{ id: 1 }] }))
    const host = await import('./playback-host-runtime')
    const full = host.takePlaybackSnapshot(true)
    expect(full.stores.player.pause).toBeUndefined()
    expect(full.stores.downloads.jobs).toEqual([{ track: { id: 1 }, status: 'saving' }])
    h.stores.player.setState({ position: 10 })
    const delta = host.takePlaybackSnapshot()
    expect(delta.stores.player).toEqual({ position: 10 })
    expect(delta.stores.playlist).toBeUndefined()
    expect(delta.revision).toBeGreaterThan(full.revision)
    delete h.stores.playlist
  })

  it('UI断开期间停止传输，重连返回正在运行的全量状态', async () => {
    const host = await import('./playback-host-runtime')
    stop = host.startPlaybackHost()
    await host.handlePlaybackRequest({ type: 'connect', storage: {} })
    await host.handlePlaybackRequest({ type: 'observe', visible: false })
    h.publish.mockClear()
    h.stores.player.setState({ status: 'playing', position: 42 })
    vi.advanceTimersByTime(1000)
    expect(h.publish).not.toHaveBeenCalled()
    const restored = await host.handlePlaybackRequest({ type: 'connect', storage: {} }) as { stores: Record<string, Record<string, unknown>> }
    expect(restored.stores.player.position).toBe(42)
    expect(h.startRuntime).toHaveBeenCalledOnce()
    expect(h.stores.player.getState().loadTrack).not.toHaveBeenCalled()
  })

  it('取消在途下载目录等待，把宿主signal标记中止', async () => {
    let signal!: AbortSignal
    let finish!: () => void
    h.stores.downloads.setState({ saveMany: (_tracks: unknown, received: AbortSignal) => {
      signal = received
      return new Promise<void>(resolve => { finish = resolve })
    } })
    const host = await import('./playback-host-runtime')
    stop = host.startPlaybackHost()
    const pending = host.handlePlaybackRequest({ type: 'action', store: 'downloads', action: 'saveMany', args: [[]], requestId: 'download-1' })
    await host.handlePlaybackRequest({ type: 'cancel', requestId: 'download-1' })
    expect(signal.aborted).toBe(true)
    finish()
    await pending
  })

  it('频谱仅在租约内采集，界面隐藏立即清理', async () => {
    const host = await import('./playback-host-runtime')
    stop = host.startPlaybackHost()
    await host.handlePlaybackRequest({ type: 'observe', visible: true, spectrum: true })
    h.publish.mockClear()
    vi.advanceTimersByTime(66)
    expect(h.publish).toHaveBeenCalledWith({ type: 'spectrum', data: new Uint8Array([1, 2]) })
    await host.handlePlaybackRequest({ type: 'observe', visible: false })
    h.publish.mockClear()
    vi.advanceTimersByTime(3000)
    expect(h.publish).not.toHaveBeenCalled()
    expect(h.spectrumRequested).toHaveBeenLastCalledWith(false)
  })

  it('拒绝未公开的引擎入口', async () => {
    const host = await import('./playback-host-runtime')
    await expect(host.handlePlaybackRequest({ type: 'action', store: 'player', action: '_engine', args: [] })).rejects.toThrow('不支持')
  })
})
