import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPlaybackCore, offlineQualityUsable, type PlaybackCoreDependencies, type PlaybackPlayer } from './playback-core'
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
  let time = 0
  let qualityListener: (quality: AudioQuality) => void = () => {}
  let providerListener: () => void = () => {}
  const engine = {
    preloadAudio: vi.fn(), waitForPreload: vi.fn().mockResolvedValue(true), releasePreloads: vi.fn(),
    load: vi.fn(() => { hasSource = true; return ++loadId }),
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(), seek: vi.fn(), setVolume: vi.fn(), setPlaybackRate: vi.fn(),
    clearSource: vi.fn(() => { hasSource = false }),
    destroy: vi.fn(), getFrequencyData: vi.fn(() => new Uint8Array([32])),
    get hasSource() { return hasSource },
    get position() { return state.position },
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
    accountSession: vi.fn(() => 1),
    capturePlaybackAccount: vi.fn(async () => 'account-token'),
    now: () => time,
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
    listen: (seconds: number) => {
      callbacks.onStatus?.('playing')
      time += seconds * 1000
      callbacks.onPosition?.(state.position + seconds * state.rate)
    },
    wait: (seconds: number) => { time += seconds * 1000 },
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
  it('只有刷歌允许接管预缓冲 普通点歌保持原有加载参数', async () => {
    const h = createHost()
    await h.state.loadTrack(track, { startAt: 60, contextId: 'shuange:1' })
    expect(h.engine.load).toHaveBeenLastCalledWith(h.candidate.url, 60, 'netease:1:lossless', expect.any(Object), true)
    expect(h.state.actualSource).toBeNull()
    expect(h.deps.reportPlayback).not.toHaveBeenCalled()
    h.callbacks.onCanPlay?.(h.loadId)
    expect(h.state.actualSource).toBe('netease')
    await h.state.loadTrack({ ...track, id: 2 }, { startAt: 70, contextId: 'shuange:2' })
    expect(h.engine.clearSource).toHaveBeenLastCalledWith(true)
    await h.state.loadTrack(track)
    expect(h.engine.clearSource).toHaveBeenLastCalledWith()
    expect(h.engine.load).toHaveBeenLastCalledWith(h.candidate.url, 0, 'netease:1:lossless', expect.any(Object))
  })

  it('缓存档位与所选音质不符时改走在线解析，平台不可用时仍用缓存', async () => {
    const h = createHost()
    vi.mocked(h.deps.fetchOfflineStatus).mockResolvedValue({ source: 'netease', id: '1', state: 'cached', entryId: 'local', quality: 'jyeffect' })
    await h.state.loadTrack(track)
    expect(h.engine.load).toHaveBeenLastCalledWith(h.candidate.url, 0, 'netease:1:lossless', expect.any(Object))
    vi.mocked(h.deps.fetchOfflineStatus).mockResolvedValue({ source: 'netease', id: '1', state: 'cached', entryId: 'local', quality: 'lossless' })
    await h.state.loadTrack(track)
    expect(h.engine.load).toHaveBeenLastCalledWith('http://127.0.0.1/api/audio-cache/file?entryId=test', 0)
  })

  it.each([
    ['jyeffect', 'lossless', true, false],
    ['lossless', 'lossless', true, true],
    ['jyeffect', 'max', true, false],
    ['hires', 'max', true, true],
    ['standard', 'max', true, false],
    ['jyeffect', 'lossless', false, true],
    [undefined, 'lossless', true, true],
  ] as const)('缓存 %s / 所选 %s / 平台可用 %s → 复用缓存 %s', (cached, wanted, online, expected) => {
    expect(offlineQualityUsable(cached, wanted, () => online)).toBe(expected)
  })

  it('登录态有效但在线解析耗尽时，仍回退到不符所选音质的已保存歌曲', async () => {
    const h = createHost()
    vi.mocked(h.deps.fetchOfflineStatus).mockResolvedValue({ source: 'netease', id: '1', state: 'pinned', entryId: 'saved', quality: 'standard' })
    h.resolver.next.mockResolvedValue(null)
    await h.state.loadTrack(track, { startAt: 30 })
    expect(h.engine.load).toHaveBeenLastCalledWith('http://127.0.0.1/api/audio-cache/file?entryId=test', 30)
    h.callbacks.onCanPlay?.(h.loadId)
    expect(h.state.playbackTransport).toBe('offline')
    expect(h.state.currentQuality).toBe('standard')
    expect(h.deps.notify).not.toHaveBeenCalled()

    // 兜底缓存损坏时不能反复重试同一文件。
    h.callbacks.onError?.('MEDIA_ERR_4', h.loadId)
    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(h.engine.load).toHaveBeenCalledTimes(1)
    expect(h.state.status).toBe('idle')
  })

  it('在线等待期间暂停和定位后，缓存兜底遵循最新播放意图', async () => {
    const h = createHost()
    vi.mocked(h.deps.fetchOfflineStatus).mockResolvedValue({ source: 'netease', id: '1', state: 'cached', entryId: 'cached', quality: 'standard' })
    const pending = deferred<PlaybackCandidate | null>()
    h.resolver.next.mockReturnValue(pending.promise)
    const loading = h.state.loadTrack(track)
    for (let i = 0; i < 10; i++) await Promise.resolve()
    h.state.pause()
    h.state.seek(45)
    pending.resolve(null)
    await loading
    expect(h.engine.load).toHaveBeenLastCalledWith('http://127.0.0.1/api/audio-cache/file?entryId=test', 45)
    expect(h.engine.play).not.toHaveBeenCalled()
    expect(h.state.status).toBe('paused')
  })

  it('换曲后旧在线解析耗尽，不能加载上一首的兜底缓存', async () => {
    const h = createHost()
    vi.mocked(h.deps.fetchOfflineStatus).mockResolvedValueOnce({ source: 'netease', id: '1', state: 'cached', entryId: 'cached', quality: 'standard' })
    const pending = deferred<PlaybackCandidate | null>()
    h.resolver.next.mockReturnValueOnce(pending.promise)
    const loading = h.state.loadTrack(track)
    for (let i = 0; i < 10; i++) await Promise.resolve()
    await h.state.loadTrack({ ...track, id: 2 })
    pending.resolve(null)
    await loading
    expect(h.engine.load).toHaveBeenCalledTimes(1)
    expect(h.engine.load).toHaveBeenLastCalledWith(h.candidate.url, 0, 'netease:1:lossless', expect.any(Object))
  })

  it('指定本次优先平台时，不用其他平台的缓存兜底', async () => {
    const h = createHost()
    vi.mocked(h.deps.fetchOfflineStatus).mockResolvedValue({ source: 'netease', id: '1', state: 'pinned', entryId: 'saved', quality: 'standard', resolved: { source: 'netease', id: '1' } })
    h.resolver.next.mockResolvedValue(null)
    await h.state.loadTrack(track, { preferredSource: 'qq' })
    expect(h.engine.load).not.toHaveBeenCalled()
    expect(h.state.status).toBe('idle')
  })

  it('刷歌预加载仍服从离线优先与媒体失败回退', async () => {
    const h = createHost()
    vi.mocked(h.deps.fetchOfflineStatus).mockResolvedValue({ source: 'netease', id: '1', state: 'cached', entryId: 'local' })
    await h.state.loadTrack(track, { startAt: 60, contextId: 'shuange:1' })
    expect(h.engine.load).toHaveBeenLastCalledWith('http://127.0.0.1/api/audio-cache/file?entryId=test', 60, undefined, undefined, true)
    h.callbacks.onError?.('MEDIA_ERR_4', h.loadId)
    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(h.resolver.next).toHaveBeenCalled()
    expect(h.engine.load).toHaveBeenLastCalledWith(h.candidate.url, 60, undefined, undefined, true)
  })

  it('真实收听排除断点位置、拖动、暂停和缓冲，停止时上报一次', async () => {
    const h = createHost()
    await h.state.loadTrack(track, { startAt: 60, contextId: 'list' })
    h.callbacks.onCanPlay?.(h.loadId)
    h.listen(10)
    h.state.pause()
    h.wait(90)
    h.state.seek(150)
    h.callbacks.onSeeking?.()
    h.wait(30)
    h.callbacks.onSeeked?.()
    h.listen(15)
    h.callbacks.onStatus?.('loading')
    h.wait(50)
    h.state.stop()
    await h.core.flushListeningReports()
    expect(h.deps.reportPlayback).toHaveBeenCalledOnce()
    expect(h.deps.reportPlayback).toHaveBeenCalledWith(track, {
      sourceId: 'list', seconds: 25, accountToken: 'account-token',
    })
    h.core.dispose()
    expect(h.deps.reportPlayback).toHaveBeenCalledTimes(1)
  })

  it('同曲重载累计不中断，自然结束与单曲循环各上报一次', async () => {
    const h = createHost()
    await h.state.loadTrack(track)
    h.callbacks.onCanPlay?.(h.loadId)
    h.listen(15)
    await h.state.loadTrack(track, { startAt: 15 })
    h.callbacks.onCanPlay?.(h.loadId)
    h.listen(10)
    h.callbacks.onStatus?.('paused')
    h.callbacks.onEnded?.()
    h.callbacks.onEnded?.()
    h.state.seek(0)
    h.state.play()
    h.listen(30)
    h.callbacks.onEnded?.()
    await h.core.flushListeningReports()
    expect(vi.mocked(h.deps.reportPlayback).mock.calls.map(([, opts]) => opts.seconds)).toEqual([25, 30])
  })

  it('切账号丢弃旧累计，账号token迟到也不能写给新账号', async () => {
    const h = createHost()
    const token = deferred<string | null>()
    vi.mocked(h.deps.capturePlaybackAccount).mockReturnValue(token.promise)
    await h.state.loadTrack(track)
    h.callbacks.onCanPlay?.(h.loadId)
    h.listen(25)
    h.state.stop()
    vi.mocked(h.deps.accountSession).mockReturnValue(2)
    token.resolve('old-account')
    await h.core.flushListeningReports()
    expect(h.deps.reportPlayback).not.toHaveBeenCalled()
  })

  it('跨源播放上报实际QQ曲目，不能带网易歌单语境；手动重播同曲结算上一轮', async () => {
    const h = createHost()
    const actual = { ...track, source: 'qq' as const, provider: 'qq' as const, id: 'qq-mid', qqId: 123 }
    h.candidate.source = 'qq'
    h.candidate.track = actual
    await h.state.loadTrack(track, { contextId: 'netease-list' })
    h.callbacks.onCanPlay?.(h.loadId)
    h.listen(25)
    await h.state.loadTrack(track)
    h.callbacks.onCanPlay?.(h.loadId)
    h.listen(30)
    await h.core.flushListeningReports()
    expect(h.deps.capturePlaybackAccount).toHaveBeenCalledWith('qq')
    expect(h.deps.reportPlayback).toHaveBeenNthCalledWith(1, actual, { sourceId: undefined, seconds: 25, accountToken: 'account-token' })
    expect(h.deps.reportPlayback).toHaveBeenNthCalledWith(2, actual, { sourceId: undefined, seconds: 30, accountToken: 'account-token' })
  })

  it('拖到结尾但没有真正播放不记录，倍速只计实际经过时间', async () => {
    const h = createHost()
    await h.state.loadTrack(track)
    h.callbacks.onCanPlay?.(h.loadId)
    h.state.seek(179)
    h.callbacks.onEnded?.()
    await h.core.flushListeningReports()
    expect(h.deps.reportPlayback).not.toHaveBeenCalled()
    h.state.seek(0)
    h.state.play()
    h.state.setRate(2)
    h.listen(25)
    h.state.stop()
    await h.core.flushListeningReports()
    expect(h.deps.reportPlayback).toHaveBeenCalledOnce()
    expect(h.deps.reportPlayback).toHaveBeenCalledWith(track, expect.objectContaining({ seconds: 25 }))
  })

  it('缓冲中定位，即使playing先于seeked到达也不累计等待或跳过的进度', async () => {
    const h = createHost()
    await h.state.loadTrack(track)
    h.callbacks.onCanPlay?.(h.loadId)
    h.listen(20)
    h.callbacks.onStatus?.('loading')
    h.wait(30)
    h.patch({ position: 150 })
    h.callbacks.onSeeking?.()
    h.callbacks.onStatus?.('playing')
    h.wait(30)
    h.callbacks.onPosition?.(150)
    h.callbacks.onSeeked?.()
    h.callbacks.onCanPlay?.(h.loadId)
    h.listen(5)
    await h.core.flushListeningReports()
    expect(h.deps.reportPlayback).toHaveBeenCalledWith(track, expect.objectContaining({ seconds: 25 }))
  })

  it('同曲重载后实际平台改变，分别结算两平台并保留实际QQ数字ID', async () => {
    const h = createHost()
    await h.state.loadTrack(track, { contextId: 'origin-list' })
    h.callbacks.onCanPlay?.(h.loadId)
    h.listen(25)
    const actual = { ...track, source: 'qq' as const, provider: 'qq' as const, id: 'qq-mid', qqId: 123 }
    h.candidate.source = 'qq'
    h.candidate.track = actual
    await h.state.loadTrack(track, { startAt: 25, contextId: 'origin-list' })
    h.callbacks.onCanPlay?.(h.loadId)
    h.listen(30)
    await h.core.flushListeningReports()
    expect(h.deps.reportPlayback).toHaveBeenNthCalledWith(1, track, { sourceId: 'origin-list', seconds: 25, accountToken: 'account-token' })
    expect(h.deps.reportPlayback).toHaveBeenNthCalledWith(2, actual, { sourceId: undefined, seconds: 30, accountToken: 'account-token' })
  })

  it('倍速完整听完短歌仍满足播放比例门槛，上报实际收听秒数', async () => {
    const h = createHost()
    const short = { ...track, duration: 30_000 }
    h.candidate.track = short
    await h.state.loadTrack(short)
    h.callbacks.onCanPlay?.(h.loadId)
    h.state.setRate(2)
    h.listen(15)
    h.callbacks.onEnded?.()
    await h.core.flushListeningReports()
    expect(h.deps.reportPlayback).toHaveBeenCalledWith(short, expect.objectContaining({ seconds: 15 }))
  })

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
    const revision = h.state.seekRevision
    h.state.seek(42)
    expect(h.state.seekRevision).toBe(revision + 1)
    h.state.seek(42)
    expect(h.state.seekRevision).toBe(revision + 2)
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
    h.state.seek(42)
    expect(h.state.seekRevision).toBe(1)
    expect(h.apple.command).toHaveBeenCalledWith({ type: 'seek', seconds: 42 })
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
