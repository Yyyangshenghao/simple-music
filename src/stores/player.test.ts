import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AudioEngineCallbacks } from '../lib/audio-engine'
import type { PlaybackCandidate, ProviderId } from '../providers/types'
import type { OfflineCacheStatus } from '../lib/offline-cache'
import type { Track } from '../types/domain'
import type { ApplePlaybackState } from '../lib/apple-music-playback'
import { appleAudioSpectrum } from '../lib/apple-audio-spectrum'

const h = vi.hoisted(() => ({
  callbacks: {} as AudioEngineCallbacks,
  loadId: 0,
  hasSource: false,
  load: vi.fn(), play: vi.fn(), pause: vi.fn(), seek: vi.fn(), rate: vi.fn(),
  status: vi.fn(), next: vi.fn(), resolver: vi.fn(), participating: vi.fn(),
  report: vi.fn(), show: vi.fn(), complete: vi.fn(), abort: vi.fn(),
  preloaded: vi.fn(),
  preferences: { playbackOrder: ['qq', 'netease'] as ProviderId[], preferOriginSource: true, multiSourceFallback: true },
  appleLoad: vi.fn(), appleStop: vi.fn(), appleCommand: vi.fn(),
  appleState: null as ((state: ApplePlaybackState) => void) | null,
  providerChanged: null as (() => void) | null,
}))
vi.mock('../lib/apple-music-playback', () => ({
  AppleMusicPlayback: vi.fn(function (onState: (state: ApplePlaybackState) => void) {
    h.appleState = onState
    return { load: h.appleLoad, stop: h.appleStop, command: h.appleCommand }
  }),
}))
vi.mock('../lib/audio-engine', () => ({
  AudioEngine: vi.fn(function (callbacks: AudioEngineCallbacks) {
    h.callbacks = callbacks
    return {
      load: h.load, play: h.play, pause: h.pause, seek: h.seek,
      setVolume: vi.fn(), setPlaybackRate: h.rate,
      clearSource: () => { h.hasSource = false },
      get hasSource() { return h.hasSource },
    }
  }),
}))
vi.mock('../lib/playback-resolver', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/playback-resolver')>()
  return {
    ...original,
    PlaybackResolver: vi.fn(function (...args: ConstructorParameters<typeof original.PlaybackResolver>) {
      h.resolver(...args)
      return {
        sourceOrder: original.buildPlaybackSourceOrder(args[0], args[2], args[3].isParticipating),
        next: h.next, abort: h.abort, complete: h.complete, attempts: [],
        completeExternal: h.complete, ignoreUrl: vi.fn(), recordExternalMediaFailure: vi.fn(),
      }
    }),
  }
})
vi.mock('../lib/track-preload', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/track-preload')>(), getPreloadedResolution: h.preloaded,
}))
vi.mock('../lib/offline-cache', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/offline-cache')>(), fetchOfflineStatus: h.status,
}))
vi.mock('./settings', () => ({ useSettingsStore: {
  getState: () => ({ audioQuality: 'lossless' }), subscribe: vi.fn(),
} }))
vi.mock('./providers', () => ({
  isProviderParticipating: h.participating,
  useProviderStore: { getState: () => h.preferences, subscribe: vi.fn((callback: () => void) => { h.providerChanged = callback }) },
}))
vi.mock('./provider-auth', () => ({ expireProviderAccount: vi.fn() }))
vi.mock('./toast', () => ({ useToastStore: { getState: () => ({ show: h.show }) } }))
vi.mock('../lib/service-registry', () => ({ serviceFor: () => ({ reportPlayback: h.report }) }))

import { usePlayerStore, registerTrackEndedHandler, registerTrackEndedInterceptor, setStopAfterCurrent } from './player'

const track: Track = {
  provider: 'qq', source: 'qq', type: 'song', id: 'origin', mid: 'original-mid',
  name: '歌曲', artist: '歌手', artists: [], duration: 180_000,
}
const offline: OfflineCacheStatus = {
  source: 'qq', id: 'origin', state: 'pinned', entryId: 'entry', quality: 'lossless',
  resolved: { source: 'netease', id: 'resolved', name: '音频歌曲', artist: '音频歌手' },
}
const online: PlaybackCandidate = {
  source: 'netease', track: { ...track, source: 'netease', provider: 'netease', id: 'online' },
  url: 'https://cdn.example.com/song.mp3', quality: { id: 'lossless', label: '无损', rank: 1 }, trial: false,
}

describe('播放器离线优先与回退', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerTrackEndedHandler(() => {})
    setStopAfterCurrent(null)
    h.status.mockReset().mockResolvedValue(offline)
    h.next.mockReset().mockResolvedValue(online)
    h.preloaded.mockReset()
    h.preferences = { playbackOrder: ['qq', 'netease'], preferOriginSource: true, multiSourceFallback: true }
    h.participating.mockReset().mockReturnValue(true)
    h.load.mockImplementation(() => { h.hasSource = true; return ++h.loadId })
    h.play.mockReset().mockResolvedValue(undefined)
    h.appleLoad.mockReset().mockResolvedValue(undefined)
    h.appleCommand.mockReset().mockResolvedValue(undefined)
    h.report.mockResolvedValue(undefined)
    h.complete.mockReturnValue({
      actualSource: 'netease', resolvedTrack: online.track, quality: online.quality, attempts: [],
    })
    h.hasSource = false
    vi.stubGlobal('window', { desktop: { serverPort: 35530, serverToken: 'test-token' } })
    usePlayerStore.setState({
      currentTrack: null, status: 'idle', playbackTransport: null, position: 0, duration: 0,
      quality: 'lossless', resolvedTrack: null, actualSource: null,
    })
  })

  it('离线命中先于平台参与判断和解析，注销/停用后仍加载本地文件', async () => {
    h.participating.mockReturnValue(false)
    await usePlayerStore.getState().loadTrack(track, { startAt: 42 })
    expect(h.resolver).not.toHaveBeenCalled()
    expect(h.participating).not.toHaveBeenCalled()
    expect(h.next).not.toHaveBeenCalled()
    expect(h.load).toHaveBeenCalledWith(expect.stringContaining('/api/audio-cache/file?'), 42)
    h.callbacks.onCanPlay?.(h.loadId)
    expect(usePlayerStore.getState().playbackTransport).toBe('offline')
  })

  it('停止播放后迟到的离线查询不加载音频或恢复播放', async () => {
    let finish!: (value: OfflineCacheStatus) => void
    h.status.mockReturnValue(new Promise<OfflineCacheStatus>((resolve) => { finish = resolve }))
    const loading = usePlayerStore.getState().loadTrack(track)
    usePlayerStore.getState().stop()
    finish(offline)
    await loading

    expect(h.load).not.toHaveBeenCalled()
    expect(h.play).not.toHaveBeenCalled()
    expect(h.resolver).not.toHaveBeenCalled()
    expect(usePlayerStore.getState()).toMatchObject({ currentTrack: null, status: 'idle', position: 0 })
  })

  it('跨源离线保留原内容曲目，提交实际音源身份和音质', async () => {
    await usePlayerStore.getState().loadTrack(track)
    expect(usePlayerStore.getState().playbackTransport).toBeNull()
    h.callbacks.onCanPlay?.(h.loadId)
    expect(usePlayerStore.getState()).toMatchObject({
      currentTrack: track, actualSource: 'netease', currentQuality: 'lossless', playbackTransport: 'offline',
      resolvedTrack: { source: 'netease', provider: 'netease', id: 'resolved', name: '音频歌曲' },
    })
  })

  it.each(['playing', 'loading', 'paused'] as const)('%s 时本次优先绕过其他平台的缓存，保留进度和播放意图', async (status) => {
    await usePlayerStore.getState().loadTrack(track)
    h.callbacks.onCanPlay?.(h.loadId)
    const preferredCandidate: PlaybackCandidate = { ...online, source: 'qq', track }
    h.next.mockResolvedValue(preferredCandidate)
    h.complete.mockReturnValue({
      actualSource: 'qq', resolvedTrack: track, quality: online.quality, attempts: [],
    })
    h.load.mockClear()
    h.play.mockClear()
    usePlayerStore.setState({ status, position: 42, contextId: 'playlist' })

    usePlayerStore.getState().preferSourceOnce('qq')
    await vi.waitFor(() => expect(h.load).toHaveBeenCalledOnce())

    expect(h.resolver).toHaveBeenCalledWith(track, 'lossless', expect.objectContaining({ preferredSource: 'qq' }), expect.any(Object))
    expect(h.load.mock.calls[0][0]).toBe(preferredCandidate.url)
    expect(h.load.mock.calls[0][1]).toBe(42)
    expect(h.play).toHaveBeenCalledTimes(status === 'paused' ? 0 : 1)
    expect(h.report).not.toHaveBeenCalled()
    h.callbacks.onCanPlay?.(h.loadId)
    expect(usePlayerStore.getState()).toMatchObject({
      currentTrack: track, actualSource: 'qq', playbackTransport: 'online',
      position: 42, contextId: 'playlist', status: status === 'paused' ? 'paused' : 'loading',
    })
  })

  it('本次优先与缓存实际平台一致时继续复用离线文件', async () => {
    usePlayerStore.setState({ currentTrack: track, status: 'paused', position: 42 })
    usePlayerStore.getState().preferSourceOnce('netease')
    await vi.waitFor(() => expect(h.load).toHaveBeenCalledOnce())
    expect(h.load).toHaveBeenCalledWith(expect.stringContaining('/api/audio-cache/file?'), 42)
    expect(h.resolver).not.toHaveBeenCalled()
    expect(h.play).not.toHaveBeenCalled()
    h.callbacks.onCanPlay?.(h.loadId)
    expect(usePlayerStore.getState()).toMatchObject({ actualSource: 'netease', playbackTransport: 'offline' })
  })

  it('没有实际平台记录的缓存按原平台判断，不覆盖另一平台的本次优先', async () => {
    h.status.mockResolvedValue({ ...offline, resolved: undefined })
    await usePlayerStore.getState().loadTrack(track, { preferredSource: 'netease' })
    expect(h.next).toHaveBeenCalledOnce()
    expect(h.load.mock.calls[0][0]).toBe(online.url)
  })

  it('快速切换本次优先时，旧缓存查询不能覆盖最后的选择', async () => {
    let finish!: (value: OfflineCacheStatus) => void
    h.status.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    usePlayerStore.setState({ currentTrack: track, status: 'playing', position: 42 })
    usePlayerStore.getState().preferSourceOnce('qq')
    usePlayerStore.getState().preferSourceOnce('netease')
    await vi.waitFor(() => expect(h.load).toHaveBeenCalledOnce())
    const latestLoadId = h.loadId
    finish(offline)
    await Promise.resolve()
    await Promise.resolve()
    h.callbacks.onCanPlay?.(latestLoadId)
    expect(h.load).toHaveBeenCalledOnce()
    expect(h.next).not.toHaveBeenCalled()
    expect(usePlayerStore.getState()).toMatchObject({ actualSource: 'netease', position: 42 })
  })

  it('本次优先不影响下一首的普通离线优先播放', async () => {
    await usePlayerStore.getState().loadTrack(track, { preferredSource: 'qq' })
    h.load.mockClear()
    h.resolver.mockClear()
    await usePlayerStore.getState().loadTrack({ ...track, id: 'next' })
    expect(h.load).toHaveBeenCalledWith(expect.stringContaining('/api/audio-cache/file?'), 0)
    expect(h.resolver).not.toHaveBeenCalled()
  })

  it.each(['direct', 'preloaded'] as const)('原平台 %s 不能绕过排在前面的本次优先平台', async (shortcut) => {
    h.status.mockResolvedValue({ state: 'missing' })
    const originalUrl = 'https://cdn.example.com/original.mp3'
    const origin = shortcut === 'direct' ? { ...track, url: originalUrl } : track
    if (shortcut === 'preloaded') h.preloaded.mockReturnValue({ url: originalUrl })
    await usePlayerStore.getState().loadTrack(origin, { preferredSource: 'netease' })
    expect(h.next).toHaveBeenCalledOnce()
    expect(h.load.mock.calls[0][0]).toBe(online.url)
    expect(h.preloaded).not.toHaveBeenCalled()
  })

  it.each(['direct', 'preloaded'] as const)('原平台排在第一时仍可使用 %s 捷径', async (shortcut) => {
    h.status.mockResolvedValue({ state: 'missing' })
    const originalUrl = 'https://cdn.example.com/original.mp3'
    const origin = shortcut === 'direct' ? { ...track, url: originalUrl } : track
    if (shortcut === 'preloaded') h.preloaded.mockReturnValue({ url: originalUrl, level: 'lossless' })
    await usePlayerStore.getState().loadTrack(origin)
    expect(h.next).not.toHaveBeenCalled()
    expect(h.load.mock.calls[0][0]).toBe(originalUrl)
  })

  it.each([
    ['direct', true], ['direct', false], ['preloaded', true], ['preloaded', false],
  ] as const)('固定顺序不会被原平台 %s 绕过（自动换源：%s）', async (shortcut, multiSourceFallback) => {
    h.preferences = { playbackOrder: ['netease', 'qq'], preferOriginSource: false, multiSourceFallback }
    h.status.mockResolvedValue({ state: 'missing' })
    const originalUrl = 'https://cdn.example.com/original.mp3'
    const origin = shortcut === 'direct' ? { ...track, url: originalUrl } : track
    if (shortcut === 'preloaded') h.preloaded.mockReturnValue({ url: originalUrl })
    await usePlayerStore.getState().loadTrack(origin)
    expect(h.next).toHaveBeenCalledOnce()
    expect(h.load.mock.calls[0][0]).toBe(online.url)
    expect(h.preloaded).not.toHaveBeenCalled()
  })

  it('坏离线文件只回退在线链一次，不重新查询或删除固定文件', async () => {
    await usePlayerStore.getState().loadTrack(track)
    const offlineLoadId = h.loadId
    h.callbacks.onError?.('MEDIA_ERR_4', offlineLoadId)
    h.callbacks.onError?.('MEDIA_ERR_4', offlineLoadId)
    await vi.waitFor(() => expect(h.load).toHaveBeenCalledTimes(2))
    expect(h.status).toHaveBeenCalledOnce()
    expect(h.next).toHaveBeenCalledOnce()
    expect(h.load.mock.calls[1][0]).toBe(online.url)
    expect(h.load.mock.calls[1][2]).toBeUndefined()
    h.callbacks.onCanPlay?.(h.loadId)
    expect(usePlayerStore.getState().playbackTransport).toBe('online')
  })

  it('缺失或状态查询失败都能继续现有在线解析', async () => {
    h.status.mockRejectedValueOnce(new Error('本地查询失败'))
    await usePlayerStore.getState().loadTrack(track)
    expect(h.next).toHaveBeenCalledOnce()
    expect(h.load.mock.calls[0][0]).toBe(online.url)
  })

  it('离线切到在线曲目不补报打卡，在线再切歌仍正常上报', async () => {
    await usePlayerStore.getState().loadTrack(track)
    h.callbacks.onCanPlay?.(h.loadId)
    usePlayerStore.setState({ position: 60, duration: 180 })
    h.status.mockResolvedValue({ source: 'qq', id: 'next', state: 'missing' })
    await usePlayerStore.getState().loadTrack({ ...track, id: 'next' })
    expect(h.report).not.toHaveBeenCalled()
    h.callbacks.onCanPlay?.(h.loadId)
    usePlayerStore.setState({ position: 60, duration: 180 })
    await usePlayerStore.getState().loadTrack({ ...track, id: 'third' })
    expect(h.report).toHaveBeenCalledOnce()
    expect(h.report).toHaveBeenCalledWith('online', expect.objectContaining({ seconds: 60 }))
  })

  it('自然播完先上报完整播放，再加载下一首且不重复上报', async () => {
    h.status.mockResolvedValue({ state: 'missing' })
    await usePlayerStore.getState().loadTrack(track, { contextId: 'playlist' })
    h.callbacks.onCanPlay?.(h.loadId)
    usePlayerStore.setState({ position: 180, duration: 180 })
    let nextLoad: Promise<void> | undefined
    registerTrackEndedHandler(() => { nextLoad = usePlayerStore.getState().loadTrack({ ...track, id: 'next' }) })
    h.callbacks.onEnded?.()
    await nextLoad
    expect(h.report).toHaveBeenCalledOnce()
    expect(h.report).toHaveBeenCalledWith('online', { sourceId: undefined, seconds: 180 })
    expect(usePlayerStore.getState().currentTrack?.id).toBe('next')
    registerTrackEndedHandler(() => {})
  })

  it('播完即停也上报，之后切歌不重复上报已结束曲目', async () => {
    h.status.mockResolvedValue({ state: 'missing' })
    await usePlayerStore.getState().loadTrack(track)
    h.callbacks.onCanPlay?.(h.loadId)
    usePlayerStore.setState({ position: 180, duration: 180 })
    const stopped = vi.fn()
    setStopAfterCurrent(stopped)
    h.callbacks.onEnded?.()
    expect(stopped).toHaveBeenCalledOnce()
    expect(h.report).toHaveBeenCalledOnce()
    usePlayerStore.getState().seek(60)
    await usePlayerStore.getState().loadTrack({ ...track, id: 'after-sleep' })
    expect(h.report).toHaveBeenCalledOnce()
  })

  it('单曲循环每次完整播放分别上报，手动提前切歌仍遵守门槛', async () => {
    h.status.mockResolvedValue({ state: 'missing' })
    await usePlayerStore.getState().loadTrack(track)
    h.callbacks.onCanPlay?.(h.loadId)
    registerTrackEndedHandler(() => {
      usePlayerStore.getState().seek(0)
      usePlayerStore.getState().play()
    })
    for (let count = 1; count <= 2; count++) {
      usePlayerStore.setState({ position: 180, duration: 180 })
      h.callbacks.onEnded?.()
      expect(h.report).toHaveBeenCalledTimes(count)
    }
    usePlayerStore.setState({ position: 5 })
    await usePlayerStore.getState().loadTrack({ ...track, id: 'early-skip' })
    expect(h.report).toHaveBeenCalledTimes(2)
    registerTrackEndedHandler(() => {})
  })

  it('特殊播放模式接管结束时立即加载下一首，也只上报一次', async () => {
    h.status.mockResolvedValue({ state: 'missing' })
    await usePlayerStore.getState().loadTrack(track)
    h.callbacks.onCanPlay?.(h.loadId)
    usePlayerStore.setState({ position: 180, duration: 180 })
    let nextLoad: Promise<void> | undefined
    const unregister = registerTrackEndedInterceptor(() => {
      nextLoad = usePlayerStore.getState().loadTrack({ ...track, id: 'intercepted-next' })
      return true
    })
    try {
      h.callbacks.onEnded?.()
      await nextLoad
      expect(h.report).toHaveBeenCalledOnce()
    } finally {
      unregister()
    }
  })

  it.each(['local', 'offline', 'below-threshold'] as const)('%s 自然结束不新增在线听歌记录', async (kind) => {
    if (kind === 'below-threshold') h.status.mockResolvedValue({ state: 'missing' })
    await usePlayerStore.getState().loadTrack(kind === 'local' ? { ...track, source: 'local', provider: 'local' } : track)
    h.callbacks.onCanPlay?.(h.loadId)
    usePlayerStore.setState({ position: kind === 'below-threshold' ? 5 : 180, duration: 180 })
    h.callbacks.onEnded?.()
    expect(h.report).not.toHaveBeenCalled()
  })

  it('暂停恢复态播放从断点读取离线文件，并支持暂停、拖动和倍速', async () => {
    usePlayerStore.setState({ currentTrack: track, position: 25, status: 'paused' })
    usePlayerStore.getState().play()
    await vi.waitFor(() => expect(h.load).toHaveBeenCalledOnce())
    expect(h.load.mock.calls[0][1]).toBe(25)
    usePlayerStore.getState().pause()
    usePlayerStore.getState().seek(50)
    usePlayerStore.getState().setRate(1.5)
    expect(h.pause).toHaveBeenCalledOnce()
    expect(h.seek).toHaveBeenCalledWith(50)
    expect(h.rate).toHaveBeenCalledWith(1.5)
  })

  it('切歌后旧离线查询迟到不替换新曲目或音频', async () => {
    let resolve!: (value: OfflineCacheStatus) => void
    h.status.mockReturnValueOnce(new Promise((done) => { resolve = done }))
    const old = usePlayerStore.getState().loadTrack(track)
    await usePlayerStore.getState().loadTrack({ ...track, id: 'new' })
    resolve(offline)
    await old
    expect(h.load).toHaveBeenCalledOnce()
    expect(usePlayerStore.getState().currentTrack?.id).toBe('new')
  })

  it.each(['offline', 'online'] as const)('%s 等待期间暂停和拖动用于最终加载', async (phase) => {
    let finish!: () => void
    if (phase === 'offline') {
      h.status.mockReturnValueOnce(new Promise(resolve => { finish = () => resolve(offline) }))
    } else {
      h.status.mockResolvedValue({ state: 'missing' })
      h.next.mockReturnValueOnce(new Promise(resolve => { finish = () => resolve(online) }))
    }
    const loading = usePlayerStore.getState().loadTrack(track)
    if (phase === 'online') await vi.waitFor(() => expect(h.next).toHaveBeenCalledOnce())
    usePlayerStore.getState().toggle()
    usePlayerStore.getState().seek(45)
    expect(usePlayerStore.getState()).toMatchObject({ status: 'paused', position: 45 })
    finish()
    await loading
    expect(h.load.mock.calls[0][1]).toBe(45)
    expect(h.play).not.toHaveBeenCalled()
    expect(usePlayerStore.getState().status).toBe('paused')
  })

  it.each(['offline', 'online'] as const)('%s 等待期间暂停再恢复复用当前请求', async (phase) => {
    let finish!: () => void
    if (phase === 'offline') {
      h.status.mockReturnValueOnce(new Promise(resolve => { finish = () => resolve(offline) }))
    } else {
      h.status.mockResolvedValue({ state: 'missing' })
      h.next.mockReturnValueOnce(new Promise(resolve => { finish = () => resolve(online) }))
    }
    const loading = usePlayerStore.getState().loadTrack(track)
    if (phase === 'online') await vi.waitFor(() => expect(h.next).toHaveBeenCalledOnce())
    usePlayerStore.getState().pause()
    usePlayerStore.getState().seek(25)
    usePlayerStore.getState().play()
    expect(h.status).toHaveBeenCalledOnce()
    expect(h.next).toHaveBeenCalledTimes(phase === 'online' ? 1 : 0)
    expect(h.play).not.toHaveBeenCalled()
    finish()
    await loading
    expect(h.load.mock.calls[0][1]).toBe(25)
    expect(h.play).toHaveBeenCalledOnce()
  })

  it('已加载候选暂停后失败回退保留暂停和最新拖动位置，恢复后可继续回退', async () => {
    await usePlayerStore.getState().loadTrack(track)
    h.play.mockClear()
    usePlayerStore.getState().pause()
    usePlayerStore.getState().seek(50)
    h.callbacks.onError?.('MEDIA_ERR_4', h.loadId)
    await vi.waitFor(() => expect(h.load).toHaveBeenCalledTimes(2))
    expect(h.load.mock.calls[1][1]).toBe(50)
    expect(h.play).not.toHaveBeenCalled()
    expect(usePlayerStore.getState().status).toBe('paused')
    usePlayerStore.getState().play()
    h.callbacks.onError?.('MEDIA_ERR_4', h.loadId)
    await vi.waitFor(() => expect(h.load).toHaveBeenCalledTimes(3))
    expect(h.play).toHaveBeenCalledTimes(2)
  })

  it('新曲等待离线查询时清除旧音轨，旧进度和结束事件不污染新目标', async () => {
    await usePlayerStore.getState().loadTrack(track)
    let finish!: (status: OfflineCacheStatus) => void
    h.status.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const next = vi.fn()
    registerTrackEndedHandler(next)
    try {
      const loading = usePlayerStore.getState().loadTrack({ ...track, id: 'new' })
      expect(h.hasSource).toBe(false)
      h.callbacks.onPosition?.(179)
      h.callbacks.onDuration?.(888)
      h.callbacks.onStatus?.('playing')
      h.callbacks.onEnded?.()
      expect(next).not.toHaveBeenCalled()
      expect(usePlayerStore.getState()).toMatchObject({ status: 'loading', position: 0, duration: 180 })
      finish(offline)
      await loading
      h.callbacks.onPosition?.(5)
      h.callbacks.onStatus?.('playing')
      expect(usePlayerStore.getState()).toMatchObject({ status: 'playing', position: 5 })
    } finally {
      registerTrackEndedHandler(() => {})
    }
  })

  it('错误候选等待下一地址时丢弃结束事件，并保留暂停和拖动意图', async () => {
    await usePlayerStore.getState().loadTrack(track)
    let finish!: (candidate: PlaybackCandidate) => void
    h.next.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const next = vi.fn()
    registerTrackEndedHandler(next)
    try {
      h.callbacks.onPosition?.(20)
      h.callbacks.onError?.('MEDIA_ERR_4', h.loadId)
      expect(h.hasSource).toBe(false)
      usePlayerStore.getState().pause()
      usePlayerStore.getState().seek(10)
      h.callbacks.onEnded?.()
      expect(next).not.toHaveBeenCalled()
      finish(online)
      await vi.waitFor(() => expect(h.load).toHaveBeenCalledTimes(2))
      expect(h.load.mock.calls[1][1]).toBe(10)
      expect(usePlayerStore.getState().status).toBe('paused')
    } finally {
      registerTrackEndedHandler(() => {})
    }
  })

  it.each(['pause', 'switch'] as const)('设备恢复等待期间 %s 不自动开播或重载新曲目', async (action) => {
    vi.useFakeTimers()
    try {
      await usePlayerStore.getState().loadTrack(track)
      h.callbacks.onPosition?.(35)
      h.callbacks.onStatus?.('playing')
      h.callbacks.onOutputDeviceChange?.(true)
      if (action === 'pause') usePlayerStore.getState().pause()
      else await usePlayerStore.getState().loadTrack({ ...track, id: 'new' })
      const requests = h.status.mock.calls.length
      await vi.advanceTimersByTimeAsync(200)
      expect(h.status).toHaveBeenCalledTimes(requests)
      if (action === 'pause') expect(usePlayerStore.getState().status).toBe('paused')
      else expect(usePlayerStore.getState().currentTrack?.id).toBe('new')
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it('设备恢复同一会话从防抖结束时的最新位置继续播放', async () => {
    vi.useFakeTimers()
    try {
      await usePlayerStore.getState().loadTrack(track)
      h.callbacks.onPosition?.(35)
      h.callbacks.onStatus?.('playing')
      h.callbacks.onOutputDeviceChange?.(true)
      usePlayerStore.getState().seek(50)
      await vi.advanceTimersByTimeAsync(200)
      expect(h.load).toHaveBeenCalledTimes(2)
      expect(h.load.mock.calls[1][1]).toBe(50)
      expect(h.play).toHaveBeenCalledTimes(2)
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })
})

describe('Apple Music 官方播放通道', () => {
  const appleTrack: Track = { ...track, source: 'apple', provider: 'apple', id: '123', mid: undefined }
  const appleCandidate: PlaybackCandidate = {
    source: 'apple', track: appleTrack, url: 'apple-music:123',
    quality: { id: 'standard', label: 'Apple Music', rank: 0 }, trial: false,
  }

  async function loadApple() {
    h.status.mockResolvedValue({ state: 'missing' })
    h.next.mockResolvedValue(appleCandidate)
    h.participating.mockReturnValue(true)
    h.appleLoad.mockResolvedValue(undefined)
    h.appleCommand.mockResolvedValue(undefined)
    await usePlayerStore.getState().loadTrack(appleTrack)
    await Promise.resolve()
  }

  it('恢复立即显示加载，加载期间再次点击可暂停', async () => {
    await loadApple()
    usePlayerStore.getState().pause()
    usePlayerStore.getState().play()
    expect(usePlayerStore.getState().status).toBe('loading')
    usePlayerStore.getState().toggle()
    expect(h.appleCommand).toHaveBeenLastCalledWith({ type: 'pause' })
    expect(usePlayerStore.getState().status).toBe('paused')
  })

  it('Apple 曲目解析期间暂停和拖动会用于最终加载，旧引擎事件不能覆盖操作', async () => {
    let finish!: (candidate: PlaybackCandidate) => void
    h.status.mockResolvedValue({ state: 'missing' })
    h.participating.mockReturnValue(true)
    h.next.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const loading = usePlayerStore.getState().loadTrack(appleTrack)
    await vi.waitFor(() => expect(finish).toBeDefined())
    usePlayerStore.getState().toggle()
    usePlayerStore.getState().seek(45)
    h.callbacks.onPosition?.(999)
    h.callbacks.onStatus?.('playing')
    expect(usePlayerStore.getState()).toMatchObject({ status: 'paused', position: 45 })
    finish(appleCandidate)
    await loading
    expect(h.appleLoad).toHaveBeenCalledWith('123', false, 45, false, expect.any(Number), 180)
  })

  it('Apple 曲目解析期间暂停再恢复复用当前加载，不重新解析', async () => {
    let finish!: (candidate: PlaybackCandidate) => void
    h.status.mockResolvedValue({ state: 'missing' })
    h.participating.mockReturnValue(true)
    h.next.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const loading = usePlayerStore.getState().loadTrack(appleTrack)
    await vi.waitFor(() => expect(finish).toBeDefined())
    usePlayerStore.getState().pause()
    usePlayerStore.getState().play()
    finish(appleCandidate)
    await loading
    expect(h.next).toHaveBeenCalledOnce()
    expect(h.appleLoad).toHaveBeenCalledWith('123', false, 0, true, expect.any(Number), 180)
  })

  beforeEach(() => {
    vi.clearAllMocks()
    h.complete.mockReturnValue({ actualSource: 'apple', resolvedTrack: appleTrack, quality: appleCandidate.quality, attempts: [] })
    h.load.mockImplementation(() => { h.hasSource = true; return ++h.loadId })
    h.play.mockResolvedValue(undefined)
    h.report.mockResolvedValue(undefined)
    h.hasSource = false
    usePlayerStore.setState({ currentTrack: null, status: 'idle', position: 0, duration: 0, resolution: null, resolvedTrack: null, actualSource: null, playbackTransport: null })
  })
  afterEach(() => {
    registerTrackEndedHandler(() => {})
    setStopAfterCurrent(null)
  })

  it('受保护歌曲不进入音频代理，支持播放状态、暂停、拖动和音量控制', async () => {
    await loadApple()
    expect(h.load).not.toHaveBeenCalled()
    expect(h.appleLoad).toHaveBeenCalledWith('123', false, 0, true, expect.any(Number), 180)
    h.appleState!({ connected: true, loggedIn: true, subscription: 'active', playbackId: 'one', status: 'playing', position: 50, duration: 180 })
    h.appleState!({ connected: true, loggedIn: true, subscription: 'active', playbackId: 'one', status: 'playing', position: 50, duration: 180 })
    expect(h.complete).toHaveBeenCalledOnce()
    expect(usePlayerStore.getState()).toMatchObject({ actualSource: 'apple', playbackTransport: 'musickit', position: 50, status: 'playing' })
    usePlayerStore.getState().pause()
    usePlayerStore.getState().seek(70)
    usePlayerStore.getState().setVolume(.3)
    expect(h.appleCommand).toHaveBeenCalledWith({ type: 'pause' })
    expect(h.appleCommand).toHaveBeenCalledWith({ type: 'seek', seconds: 70 })
    expect(h.appleCommand).toHaveBeenCalledWith({ type: 'volume', volume: .3 })
  })

  it('主动停止 Apple 会话后迟到播放状态和结束事件不能回写', async () => {
    await loadApple()
    const stale = h.appleState!
    const ended = vi.fn()
    registerTrackEndedHandler(ended)
    usePlayerStore.getState().stop()
    stale({ connected: true, loggedIn: true, subscription: 'active', playbackId: 'one', status: 'playing', position: 50, duration: 180 })
    stale({ connected: true, loggedIn: true, subscription: 'active', playbackId: 'one', status: 'ended', position: 180, duration: 180 })

    expect(h.appleStop).toHaveBeenCalled()
    expect(ended).not.toHaveBeenCalled()
    expect(usePlayerStore.getState()).toMatchObject({ currentTrack: null, status: 'idle', position: 0, playbackTransport: null })
  })

  it('Apple Music 播放时可视化读取独立窗口的频谱', async () => {
    await loadApple()
    h.appleState!({ connected: true, loggedIn: true, subscription: 'active', playbackId: 'one', status: 'playing', position: 10, duration: 180 })
    const read = vi.spyOn(appleAudioSpectrum, 'read').mockReturnValue(Uint8Array.of(64, 128))
    try {
      expect([...usePlayerStore.getState()._frequencyData()]).toEqual([64, 128])
      usePlayerStore.getState().pause()
      expect(usePlayerStore.getState()._frequencyData()).toHaveLength(0)
    } finally {
      read.mockRestore()
    }
  })

  it('切回其他音源停止浏览器音频，旧状态不能覆盖新曲目', async () => {
    await loadApple()
    const stale = h.appleState!
    h.status.mockResolvedValue(offline)
    await usePlayerStore.getState().loadTrack(track)
    expect(h.appleStop).toHaveBeenCalled()
    stale({ connected: true, loggedIn: true, subscription: 'active', playbackId: 'old', status: 'playing', position: 99, duration: 180 })
    expect(usePlayerStore.getState().currentTrack).toEqual(track)
    expect(usePlayerStore.getState().position).toBe(0)
  })

  it('DRM或断线错误不静默换成另一平台，也不保留播放中状态', async () => {
    await loadApple()
    h.appleState!({ connected: true, loggedIn: true, subscription: 'active', playbackId: 'one', status: 'playing', position: 20, duration: 180 })
    const calls = h.next.mock.calls.length
    h.appleState!({ connected: true, loggedIn: true, subscription: 'inactive', playbackId: 'one', status: 'error', position: 0, duration: 0, error: '订阅不可用' })
    expect(h.next).toHaveBeenCalledTimes(calls)
    expect(usePlayerStore.getState()).toMatchObject({ status: 'paused', actualSource: null, playbackTransport: null, resolvedTrack: null, resolution: null })
    expect(h.show).toHaveBeenCalledWith('订阅不可用')
  })

  it('自然结束只推进一次队列，重复的旧结束消息被忽略', async () => {
    const next = vi.fn()
    registerTrackEndedHandler(next)
    await loadApple()
    const stopCapture = vi.spyOn(appleAudioSpectrum, 'stop')
    const ended: ApplePlaybackState = { connected: true, loggedIn: true, subscription: 'active', playbackId: 'one', status: 'ended', position: 180, duration: 180 }
    h.appleState!(ended)
    h.appleState!(ended)
    await Promise.resolve()
    expect(next).toHaveBeenCalledOnce()
    expect(stopCapture).toHaveBeenCalledOnce()
    expect(usePlayerStore.getState()).toMatchObject({ status: 'paused', position: 0 })
    expect(h.report).not.toHaveBeenCalled()
    stopCapture.mockRestore()
  })

  it('自动接播下一首 Apple 曲目时复用捕获', async () => {
    await loadApple()
    const stopCapture = vi.spyOn(appleAudioSpectrum, 'stop')
    let nextLoad!: Promise<void>
    registerTrackEndedHandler(() => { nextLoad = usePlayerStore.getState().loadTrack({ ...appleTrack, id: 'next' }) })
    h.appleState!({ connected: true, loggedIn: true, subscription: 'active', playbackId: 'one', status: 'ended', position: 180, duration: 180 })
    await nextLoad
    expect(stopCapture).not.toHaveBeenCalled()
    stopCapture.mockRestore()
  })

  it('睡眠定时的播完当前曲优先于自动下一首', async () => {
    const next = vi.fn(), sleep = vi.fn()
    registerTrackEndedHandler(next)
    setStopAfterCurrent(sleep)
    await loadApple()
    h.appleState!({ connected: true, loggedIn: true, subscription: 'active', playbackId: 'one', status: 'ended', position: 180, duration: 180 })
    expect(sleep).toHaveBeenCalledOnce()
    expect(next).not.toHaveBeenCalled()
  })

  it('本地音频引擎的迟到状态和进度不能覆盖浏览器播放器', async () => {
    await loadApple()
    h.appleState!({ connected: true, loggedIn: true, subscription: 'active', playbackId: 'one', status: 'playing', position: 50, duration: 180 })
    h.callbacks.onPosition?.(999)
    h.callbacks.onDuration?.(888)
    h.callbacks.onStatus?.('idle')
    expect(usePlayerStore.getState()).toMatchObject({ status: 'playing', position: 50, duration: 180 })
  })

  it('暂停态恢复保留断点，不调用普通音频引擎或倍速', async () => {
    await loadApple()
    h.appleLoad.mockClear()
    await usePlayerStore.getState().loadTrack(appleTrack, { startAt: 42, autoplay: false })
    expect(h.appleLoad).toHaveBeenCalledWith('123', false, 42, false, expect.any(Number), 180)
    expect(h.load).not.toHaveBeenCalled()
    usePlayerStore.getState().setRate(1.5)
    expect(h.rate).not.toHaveBeenCalledWith(1.5)
    expect(usePlayerStore.getState().rate).toBe(1)
  })

  it('停用当前音源停止浏览器播放，并终止旧回调', async () => {
    await loadApple()
    const stale = h.appleState!
    h.participating.mockReturnValue(false)
    h.next.mockResolvedValue(null)
    h.providerChanged!()
    await vi.waitFor(() => expect(usePlayerStore.getState().status).toBe('idle'))
    expect(h.appleStop).toHaveBeenCalled()
    stale({ connected: true, loggedIn: true, subscription: 'active', playbackId: 'one', status: 'playing', position: 99, duration: 180 })
    expect(usePlayerStore.getState().status).toBe('idle')
  })
})
