import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AudioEngineCallbacks } from '../lib/audio-engine'
import type { PlaybackCandidate } from '../providers/types'
import type { OfflineCacheStatus } from '../lib/offline-cache'
import type { Track } from '../types/domain'
import type { ApplePlaybackState } from '../lib/apple-music-playback'

const h = vi.hoisted(() => ({
  callbacks: {} as AudioEngineCallbacks,
  loadId: 0,
  hasSource: false,
  load: vi.fn(), play: vi.fn(), pause: vi.fn(), seek: vi.fn(), rate: vi.fn(),
  status: vi.fn(), next: vi.fn(), resolver: vi.fn(), participating: vi.fn(),
  report: vi.fn(), show: vi.fn(), complete: vi.fn(), abort: vi.fn(),
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
vi.mock('../lib/playback-resolver', () => ({
  PlaybackResolver: vi.fn(function () {
    h.resolver()
    return {
      next: h.next, abort: h.abort, complete: h.complete, attempts: [],
      completeExternal: h.complete, ignoreUrl: vi.fn(), recordExternalMediaFailure: vi.fn(),
    }
  }),
}))
vi.mock('../lib/offline-cache', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/offline-cache')>(), fetchOfflineStatus: h.status,
}))
vi.mock('./settings', () => ({ useSettingsStore: {
  getState: () => ({ audioQuality: 'lossless' }), subscribe: vi.fn(),
} }))
vi.mock('./providers', () => ({
  isProviderParticipating: h.participating,
  useProviderStore: { getState: () => ({
    playbackOrder: ['qq', 'netease'], preferOriginSource: true, multiSourceFallback: true,
  }), subscribe: vi.fn((callback: () => void) => { h.providerChanged = callback }) },
}))
vi.mock('./provider-auth', () => ({ expireProviderAccount: vi.fn() }))
vi.mock('./toast', () => ({ useToastStore: { getState: () => ({ show: h.show }) } }))
vi.mock('../lib/service-registry', () => ({ serviceFor: () => ({ reportPlayback: h.report }) }))

import { usePlayerStore, registerTrackEndedHandler, setStopAfterCurrent } from './player'

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
    h.status.mockReset().mockResolvedValue(offline)
    h.next.mockReset().mockResolvedValue(online)
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

  it('跨源离线保留原内容曲目，提交实际音源身份和音质', async () => {
    await usePlayerStore.getState().loadTrack(track)
    expect(usePlayerStore.getState().playbackTransport).toBeNull()
    h.callbacks.onCanPlay?.(h.loadId)
    expect(usePlayerStore.getState()).toMatchObject({
      currentTrack: track, actualSource: 'netease', currentQuality: 'lossless', playbackTransport: 'offline',
      resolvedTrack: { source: 'netease', provider: 'netease', id: 'resolved', name: '音频歌曲' },
    })
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
    expect(h.appleLoad).toHaveBeenCalledWith('123', false, 0, true, expect.any(Number))
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
    const ended: ApplePlaybackState = { connected: true, loggedIn: true, subscription: 'active', playbackId: 'one', status: 'ended', position: 180, duration: 180 }
    h.appleState!(ended)
    h.appleState!(ended)
    expect(next).toHaveBeenCalledOnce()
    expect(usePlayerStore.getState()).toMatchObject({ status: 'paused', position: 0 })
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
    expect(h.appleLoad).toHaveBeenCalledWith('123', false, 42, false, expect.any(Number))
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
