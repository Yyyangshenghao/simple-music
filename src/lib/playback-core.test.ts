import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPlaybackCore, type PlaybackCoreDependencies, type PlaybackPlayer } from './playback-core'
import type { AudioEngineCallbacks } from './audio-engine'
import type { ApplePlaybackState } from './apple-music-playback'
import type { OfflineCacheStatus } from './offline-cache'
import type { PlaybackResolution } from './playback-resolver'
import type { PlaybackCandidate } from '../providers/types'
import type { AudioQuality, Track } from '../types/domain'

const track: Track = {
  provider: 'netease', source: 'netease', type: 'song', id: 1,
  name: '歌曲', artist: '歌手', artists: [], duration: 180_000,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((finish) => { resolve = finish })
  return { promise, resolve }
}

function createHost() {
  let state: PlaybackPlayer
  let quality: AudioQuality = 'lossless'
  let callbacks: AudioEngineCallbacks = {}
  let appleState: (state: ApplePlaybackState) => void = () => {}
  let loadId = 0
  let hasSource = false
  let qualityListener: (quality: AudioQuality) => void = () => {}
  let providerListener: () => void = () => {}
  const engine = {
    load: vi.fn(() => { hasSource = true; return ++loadId }),
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(), seek: vi.fn(), setVolume: vi.fn(), setPlaybackRate: vi.fn(),
    clearSource: vi.fn(() => { hasSource = false }),
    destroy: vi.fn(), getFrequencyData: vi.fn(() => new Uint8Array([32])),
    get hasSource() { return hasSource },
    position: 0,
  }
  const candidate: PlaybackCandidate = {
    source: 'netease', track, url: 'https://cdn.example.com/song.mp3',
    quality: { id: 'lossless', label: '无损', rank: 1 }, trial: false,
  }
  function resolution(next: PlaybackCandidate): PlaybackResolution {
    return {
      originTrack: track, resolvedTrack: next.track, actualSource: next.source,
      url: next.url, quality: next.quality, trial: next.trial, attempts: [],
      scrobbleTarget: { source: next.source, trackId: next.track.id },
    }
  }
  const resolver = {
    sourceOrder: [candidate.source], attempts: [], failureMessage: null,
    next: vi.fn().mockResolvedValue(candidate), abort: vi.fn(),
    complete: vi.fn(resolution), completeExternal: vi.fn(resolution),
    ignoreUrl: vi.fn(), recordExternalMediaFailure: vi.fn(),
  }
  const apple = {
    load: vi.fn().mockResolvedValue(undefined), command: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(), lyricPosition: 0,
  }
  const unsubscribeQuality = vi.fn()
  const unsubscribeProviders = vi.fn()
  const deps: PlaybackCoreDependencies = {
    getState: () => state,
    setState: (patch) => { state = { ...state, ...patch } },
    createEngine: vi.fn((next) => { callbacks = next; return engine }),
    createApplePlayback: vi.fn((next) => { appleState = next; return apple }),
    createResolver: vi.fn(() => resolver),
    getQuality: () => quality,
    setQuality: (next) => { quality = next; qualityListener(next) },
    subscribeQuality: vi.fn((listener) => { qualityListener = listener; return unsubscribeQuality }),
    getSourcePreferences: () => ({ playbackOrder: ['netease', 'qq'], preferOriginSource: true, multiSourceFallback: true }),
    isParticipating: vi.fn(() => true),
    subscribeProviders: vi.fn((listener) => { providerListener = listener; return unsubscribeProviders }),
    resolvePending: vi.fn(async (pending) => ({ ...pending, pending: false })),
    localAudioUrl: (local) => `http://127.0.0.1/api/local/audio?id=${String(local.id)}`,
    fetchOfflineStatus: vi.fn(async (): Promise<OfflineCacheStatus> => ({ source: 'netease', id: '1', state: 'missing' })),
    offlineFileUrl: (status) => status.state === 'missing' ? null : 'http://127.0.0.1/api/audio-cache/file?entryId=test',
    getPreloadedResolution: vi.fn(() => undefined),
    audioDiskCacheKey: (next, level) => `${next.source}:${String(next.id)}:${level}`,
    reportPlayback: vi.fn(), beginIntent: vi.fn(), notify: vi.fn(),
    appleSpectrum: { requestCapture: vi.fn(), stop: vi.fn(), read: () => new Uint8Array([64]) },
  }
  const core = createPlaybackCore(deps)
  state = core.player
  return {
    core, deps, engine, resolver, apple, candidate, unsubscribeQuality, unsubscribeProviders,
    get state() { return state },
    get callbacks() { return callbacks },
    get loadId() { return loadId },
    patch: deps.setState,
    emitQuality: (next: AudioQuality) => { quality = next; qualityListener(next) },
    emitProviders: () => providerListener(),
    emitApple: (patch: Partial<ApplePlaybackState>) => appleState({
      connected: true, loggedIn: true, subscription: 'active', playbackId: 'session',
      status: 'playing', position: 0, duration: 180, ...patch,
    }),
  }
}

afterEach(() => { vi.useRealTimers() })

describe('无界面播放核心', () => {
  it('创建不绑定宿主，显式启动幂等；释放取消订阅并拒绝旧回调和新命令', async () => {
    const h = createHost()
    expect(h.deps.createEngine).not.toHaveBeenCalled()
    expect(h.deps.subscribeQuality).not.toHaveBeenCalled()
    expect(h.deps.subscribeProviders).not.toHaveBeenCalled()
    h.core.start()
    h.core.start()
    expect(h.deps.subscribeQuality).toHaveBeenCalledTimes(1)
    expect(h.deps.subscribeProviders).toHaveBeenCalledTimes(1)
    await h.state.loadTrack({ ...track, source: 'local' })
    h.callbacks.onCanPlay?.(h.loadId)
    h.patch({ status: 'playing', position: 42 })
    const snapshot = h.state
    h.core.dispose()
    h.core.dispose()
    h.core.start()
    h.callbacks.onPosition?.(100)
    h.callbacks.onStatus?.('paused')
    h.callbacks.onOutputDeviceChange?.(true)
    h.callbacks.onCanPlay?.(h.loadId)
    h.emitQuality('standard')
    h.emitProviders()
    await h.state.loadTrack(track)
    h.state.play()
    h.state.pause()
    expect(h.state).toBe(snapshot)
    expect(h.engine.destroy).toHaveBeenCalledTimes(1)
    expect(h.unsubscribeQuality).toHaveBeenCalledTimes(1)
    expect(h.unsubscribeProviders).toHaveBeenCalledTimes(1)
    expect(h.deps.createEngine).toHaveBeenCalledTimes(1)
    expect(h.deps.createResolver).not.toHaveBeenCalled()
  })

  it('不同实例独立维护引擎、自然结束和睡眠回调', async () => {
    const a = createHost()
    const b = createHost()
    const nextA = vi.fn()
    const nextB = vi.fn()
    const sleepA = vi.fn()
    a.core.registerTrackEndedHandler(nextA)
    b.core.registerTrackEndedHandler(nextB)
    a.core.setStopAfterCurrent(sleepA)
    await a.state.loadTrack({ ...track, source: 'local' })
    await b.state.loadTrack({ ...track, source: 'local', id: 2 })
    a.callbacks.onEnded?.()
    expect(sleepA).toHaveBeenCalledTimes(1)
    expect(nextA).not.toHaveBeenCalled()
    expect(nextB).not.toHaveBeenCalled()
    a.core.dispose()
    b.callbacks.onEnded?.()
    expect(nextB).toHaveBeenCalledTimes(1)
    expect(b.state.currentTrack?.id).toBe(2)
    expect(b.engine.destroy).not.toHaveBeenCalled()
    b.core.dispose()
  })

  it('等待详情时的暂停和定位决定最终起播意图', async () => {
    const h = createHost()
    const details = deferred<Track>()
    vi.mocked(h.deps.resolvePending).mockReturnValue(details.promise)
    const loading = h.state.loadTrack({ ...track, pending: true })
    h.state.pause()
    h.state.seek(42)
    details.resolve(track)
    await loading
    expect(h.engine.load).toHaveBeenCalledWith(h.candidate.url, 42, 'netease:1:lossless', expect.any(Object))
    expect(h.engine.play).not.toHaveBeenCalled()
    h.callbacks.onStatus?.('loading')
    expect(h.state.status).toBe('paused')
    expect(h.state.position).toBe(42)
    h.core.dispose()
  })

  it.each(['details', 'offline', 'resolver'] as const)('释放使迟到的 %s 结果失效', async (phase) => {
    const h = createHost()
    const details = deferred<Track>()
    const offline = deferred<OfflineCacheStatus>()
    const candidate = deferred<PlaybackCandidate>()
    if (phase === 'details') vi.mocked(h.deps.resolvePending).mockReturnValue(details.promise)
    if (phase === 'offline') vi.mocked(h.deps.fetchOfflineStatus).mockReturnValue(offline.promise)
    if (phase === 'resolver') h.resolver.next.mockReturnValue(candidate.promise)
    const loading = h.state.loadTrack({ ...track, pending: phase === 'details' })
    await vi.waitFor(() => {
      if (phase === 'details') expect(h.deps.resolvePending).toHaveBeenCalled()
      if (phase === 'offline') expect(h.deps.fetchOfflineStatus).toHaveBeenCalled()
      if (phase === 'resolver') expect(h.resolver.next).toHaveBeenCalled()
    })
    h.core.dispose()
    const snapshot = h.state
    details.resolve(track)
    offline.resolve({ source: 'netease', id: '1', state: 'pinned', entryId: 'test' })
    candidate.resolve(h.candidate)
    await loading
    expect(h.state).toBe(snapshot)
    expect(h.engine.load).not.toHaveBeenCalled()
    expect(h.engine.play).not.toHaveBeenCalled()
    expect(h.engine.destroy).toHaveBeenCalledTimes(1)
    if (phase === 'resolver') expect(h.resolver.abort).toHaveBeenCalledTimes(1)
  })

  it('音质订阅不唤醒暂停曲目；播放中重载保留位置与语境', async () => {
    const h = createHost()
    h.core.start()
    await h.state.loadTrack(track, { autoplay: false, startAt: 42, contextId: 'playlist' })
    h.emitQuality('standard')
    expect(h.state.quality).toBe('standard')
    expect(h.engine.load).toHaveBeenCalledTimes(1)
    expect(h.engine.play).not.toHaveBeenCalled()
    h.patch({ status: 'playing' })
    h.emitQuality('lossless')
    await vi.waitFor(() => expect(h.engine.load).toHaveBeenCalledTimes(2))
    expect(h.state.position).toBe(42)
    expect(h.state.contextId).toBe('playlist')
    expect(h.engine.play).toHaveBeenCalledTimes(1)
    expect(h.deps.beginIntent).toHaveBeenCalledTimes(1)
    h.core.dispose()
  })

  it('平台失效重建候选链，暂停状态仍不自动播放', async () => {
    const h = createHost()
    h.core.start()
    await h.state.loadTrack(track, { autoplay: false, startAt: 42 })
    vi.mocked(h.deps.isParticipating).mockImplementation((source) => source !== 'netease')
    h.resolver.sourceOrder = ['qq']
    h.resolver.next.mockResolvedValue({ ...h.candidate, source: 'qq', track: { ...track, source: 'qq' } })
    h.emitProviders()
    await vi.waitFor(() => expect(h.engine.load).toHaveBeenCalledTimes(2))
    expect(h.deps.createResolver).toHaveBeenLastCalledWith(track, 'lossless', expect.objectContaining({ playbackOrder: ['qq'] }))
    expect(h.state.status).toBe('paused')
    expect(h.state.position).toBe(42)
    expect(h.engine.play).not.toHaveBeenCalled()
    h.core.dispose()
  })

  it('释放取消设备恢复计时器，旧设备回调不能重建引擎', async () => {
    vi.useFakeTimers()
    const h = createHost()
    await h.state.loadTrack({ ...track, source: 'local' })
    h.patch({ status: 'playing' })
    h.callbacks.onOutputDeviceChange?.(true)
    expect(vi.getTimerCount()).toBe(1)
    h.core.dispose()
    h.callbacks.onOutputDeviceChange?.(true)
    await vi.runAllTimersAsync()
    expect(vi.getTimerCount()).toBe(0)
    expect(h.engine.load).toHaveBeenCalledTimes(1)
    expect(h.deps.createEngine).toHaveBeenCalledTimes(1)
  })

  it('Apple 独立会话释放后忽略迟到状态，普通引擎不加载受保护音频', async () => {
    const h = createHost()
    const appleTrack: Track = { ...track, source: 'apple', provider: 'apple' }
    h.resolver.sourceOrder = ['apple']
    h.resolver.next.mockResolvedValue({ ...h.candidate, source: 'apple', track: appleTrack, url: 'apple-music:1' })
    await h.state.loadTrack(appleTrack)
    h.emitApple({ status: 'playing', position: 42 })
    expect(h.state.playbackTransport).toBe('musickit')
    expect(h.engine.load).not.toHaveBeenCalled()
    expect(h.engine.play).not.toHaveBeenCalled()
    const sleep = vi.fn()
    const next = vi.fn()
    h.core.setStopAfterCurrent(sleep)
    h.core.registerTrackEndedHandler(next)
    h.core.dispose()
    const snapshot = h.state
    h.emitApple({ status: 'ended', position: 180 })
    expect(h.state).toBe(snapshot)
    expect(h.apple.stop).toHaveBeenCalledTimes(1)
    expect(h.deps.appleSpectrum.stop).toHaveBeenCalled()
    expect(sleep).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
  })
})
