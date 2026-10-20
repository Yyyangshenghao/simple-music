import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AudioEngineCallbacks } from './audio-engine'
import type { Track } from '../types/domain'

const h = vi.hoisted(() => ({ callbacks: {} as AudioEngineCallbacks, load: vi.fn(), play: vi.fn(), pause: vi.fn() }))
vi.mock('./audio-engine', () => ({ AudioEngine: vi.fn(function (callbacks: AudioEngineCallbacks) {
  h.callbacks = callbacks
  return { load: h.load, play: h.play, pause: h.pause, setVolume: vi.fn(), setPlaybackRate: vi.fn(),
    hasSource: true, clearSource: vi.fn() }
}) }))

import { startPlaybackCore, usePlayerStore } from '../stores/player'
import { useSleepTimerStore } from '../stores/sleep-timer'
import { useShuangeStore, __resetOffsetCache } from '../stores/shuange'
import { useNavigationStore } from '../stores/navigation'
import { useProviderStore } from '../stores/providers'
import { localMusicService } from './local-music-service'
import { neteaseService } from './service-registry'
import { __resetShuangeRecommendationProfile } from './shuange-recommendation'
import { initShuangePlayback } from './shuange-playback'
import { clearProviderRequestCache } from './provider-request-cache'

const track: Track = { source: 'local', provider: 'local', type: 'local', id: 'first', name: '当前整曲', artist: '', artists: [], duration: 180_000 }
const next = vi.fn(async () => {})
const realNext = useShuangeStore.getState().next
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve() }
let stop: (() => void) | undefined
startPlaybackCore()
beforeEach(async () => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  vi.stubGlobal('window', { desktop: { serverPort: 35530 } })
  __resetOffsetCache()
  clearProviderRequestCache()
  __resetShuangeRecommendationProfile()
  useProviderStore.setState({ playbackOrder: ['netease'], byId: {
    netease: { enabled: true, auth: 'authenticated' }, qq: { enabled: false, auth: 'anonymous' }, apple: { enabled: false, auth: 'anonymous' }
  } })
  useSleepTimerStore.getState().cancel()
  useSleepTimerStore.getState().setFinishTrack(true)
  h.load.mockReturnValue(1)
  h.play.mockResolvedValue(undefined)
  h.pause.mockImplementation(() => h.callbacks.onStatus?.('paused'))
  useNavigationStore.setState({ currentView: 'shuange' })
  useShuangeStore.setState({ active: true, loading: false, feed: [track, { ...track, id: 'next' }], index: 0,
    offset: { startSec: 30, endSec: 50, kind: 'refrain' }, next })
  await usePlayerStore.getState().loadTrack(track, { startAt: 30, contextId: 'shuange:1' })
  h.callbacks.onStatus?.('playing')
  // 隔离启动预热 此处专门验证下一首补货与睡眠的竞态
  const warmup = vi.spyOn(useShuangeStore.getState(), 'warmup').mockResolvedValueOnce()
  stop = initShuangePlayback()
  warmup.mockRestore()
})
afterEach(() => {
  stop?.()
  useSleepTimerStore.getState().cancel()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('无React刷歌到点后播完当前整曲，片段末尾不再切卡，自然结束停播并结束等待', () => {
  useSleepTimerStore.getState().start(1)
  vi.advanceTimersByTime(60_000)
  expect(useSleepTimerStore.getState().phase).toBe('finishing-track')
  h.callbacks.onPosition?.(50)
  h.callbacks.onPosition?.(120)
  expect(next).not.toHaveBeenCalled()
  expect(usePlayerStore.getState().status).toBe('playing')
  h.callbacks.onEnded?.()
  expect(usePlayerStore.getState()).toMatchObject({ currentTrack: track, status: 'paused', position: 0 })
  expect(useSleepTimerStore.getState().phase).toBe('idle')
  expect(next).not.toHaveBeenCalled()
  expect(useShuangeStore.getState()).toMatchObject({ active: true, index: 0 })
})

it('取消播完当前曲的等待后，恢复正常片段推进', () => {
  useSleepTimerStore.getState().start(1)
  vi.advanceTimersByTime(60_000)
  h.callbacks.onPosition?.(50)
  expect(next).not.toHaveBeenCalled()
  useSleepTimerStore.getState().cancel()
  h.callbacks.onPosition?.(51)
  expect(next).toHaveBeenCalledOnce()
})

it('关闭播完当前曲时到点立即暂停，片段进度不再推进', () => {
  useSleepTimerStore.getState().setFinishTrack(false)
  useSleepTimerStore.getState().start(1)
  vi.advanceTimersByTime(60_000)
  expect(h.pause).toHaveBeenCalledOnce()
  expect(usePlayerStore.getState().status).toBe('paused')
  h.callbacks.onPosition?.(50)
  expect(next).not.toHaveBeenCalled()
  expect(useSleepTimerStore.getState().phase).toBe('idle')
})

it.each([[true, false], [false, false], [true, true]])('自动补货在途时睡眠到点，迟到结果不切卡或重播（finish=%s, ended=%s）', async (finishTrack, ended) => {
  let resolve!: (tracks: Track[]) => void
  vi.spyOn(neteaseService, 'getDailySongs').mockReturnValueOnce(new Promise(done => { resolve = done }))
  vi.spyOn(neteaseService, 'getRecommendPlaylists').mockResolvedValue([])
  vi.spyOn(neteaseService, 'getRadarPlaylist').mockResolvedValue(null)
  vi.spyOn(neteaseService, 'getLyrics').mockResolvedValue([])
  const load = vi.spyOn(usePlayerStore.getState(), 'loadTrack').mockResolvedValue()
  useShuangeStore.setState({ feed: [track], next: realNext })
  useSleepTimerStore.getState().setFinishTrack(finishTrack)
  useSleepTimerStore.getState().start(1)
  h.callbacks.onPosition?.(50)
  if (ended) h.callbacks.onEnded?.()
  vi.advanceTimersByTime(60_000)
  if (ended) expect(useSleepTimerStore.getState().phase).toBe('idle')
  resolve([{ ...track, source: 'netease', provider: 'netease', id: 'refilled' }])
  await flush()
  expect(load).not.toHaveBeenCalled()
  expect(useShuangeStore.getState().index).toBe(0)
  if (!finishTrack || ended) expect(usePlayerStore.getState().status).toBe('paused')
  // 用户主动切歌仍可消费已经补好的候选，不受自动推进守卫限制。
  await useShuangeStore.getState().next()
  expect(load).toHaveBeenCalledOnce()
})

it('自然结束等待补货时显示暂停，未有后续停止意图则补货完成正常自动起播', async () => {
  let resolve!: (tracks: Track[]) => void
  vi.spyOn(neteaseService, 'getDailySongs').mockReturnValueOnce(new Promise(done => { resolve = done }))
  vi.spyOn(neteaseService, 'getRecommendPlaylists').mockResolvedValue([])
  vi.spyOn(neteaseService, 'getRadarPlaylist').mockResolvedValue(null)
  vi.spyOn(neteaseService, 'getLyrics').mockResolvedValue([])
  const load = vi.spyOn(usePlayerStore.getState(), 'loadTrack').mockResolvedValue()
  useShuangeStore.setState({ feed: [track], next: realNext })
  h.callbacks.onEnded?.()
  expect(usePlayerStore.getState().status).toBe('paused')
  resolve([{ ...track, source: 'netease', provider: 'netease', id: 'refilled' }])
  await flush()
  expect(load).toHaveBeenCalledOnce()
  expect(load).toHaveBeenCalledWith(expect.objectContaining({ id: 'refilled' }), expect.objectContaining({ autoplay: true }))
  expect(useShuangeStore.getState().index).toBe(1)
})

it.each([true, false])('定位等待期间睡眠到点后载入已选卡为暂停，不重新出声（finish=%s）', async finishTrack => {
  let resolve!: (lines: never[]) => void
  vi.spyOn(localMusicService, 'getLyrics').mockReturnValueOnce(new Promise(done => { resolve = done }))
  useSleepTimerStore.getState().setFinishTrack(finishTrack)
  useSleepTimerStore.getState().start(1 / 60)
  vi.advanceTimersByTime(999)
  const loading = useShuangeStore.getState().loadIndex(1)
  expect(usePlayerStore.getState().status).toBe('paused')
  vi.advanceTimersByTime(1)
  h.play.mockClear()
  resolve([])
  await loading
  expect(h.play).not.toHaveBeenCalled()
  expect(usePlayerStore.getState()).toMatchObject({ status: 'paused', currentTrack: { id: 'next' } })
  expect(useShuangeStore.getState()).toMatchObject({ index: 1, loading: false })
})

it.each(['pause', 'stop', 'play', 'load'] as const)('定位等待尊重后来的 %s 意图，不让旧起播夺回控制', async action => {
  let resolve!: (lines: never[]) => void
  vi.spyOn(localMusicService, 'getLyrics').mockReturnValueOnce(new Promise(done => { resolve = done }))
  const loading = useShuangeStore.getState().loadIndex(1)
  const player = usePlayerStore.getState()
  if (action === 'load') await player.loadTrack({ ...track, id: 'external' })
  else player[action]()
  if (action === 'play' || action === 'load') h.callbacks.onStatus?.('playing')
  h.play.mockClear()
  h.load.mockClear()
  resolve([])
  await loading
  expect(h.play).not.toHaveBeenCalled()
  if (action === 'pause') expect(usePlayerStore.getState()).toMatchObject({ status: 'paused', currentTrack: { id: 'next' } })
  else {
    expect(h.load).not.toHaveBeenCalled()
    expect(useShuangeStore.getState()).toMatchObject({ index: 0, loading: false })
    expect(usePlayerStore.getState()).toMatchObject(action === 'stop' ? { status: 'idle', currentTrack: null }
      : { status: 'playing', currentTrack: { id: action === 'load' ? 'external' : 'first' } })
  }
})

it('等待整曲结束时手动切卡，旧音频在定位等待中结束也不能重新起播新卡', async () => {
  let resolve!: (lines: never[]) => void
  vi.spyOn(localMusicService, 'getLyrics').mockReturnValueOnce(new Promise(done => { resolve = done }))
  useSleepTimerStore.getState().start(1)
  vi.advanceTimersByTime(60_000)
  expect(useSleepTimerStore.getState().phase).toBe('finishing-track')
  const loading = useShuangeStore.getState().loadIndex(1)
  h.callbacks.onEnded?.()
  expect(useSleepTimerStore.getState().phase).toBe('idle')
  h.play.mockClear()
  resolve([])
  await loading
  expect(h.play).not.toHaveBeenCalled()
  expect(usePlayerStore.getState()).toMatchObject({ status: 'paused', currentTrack: { id: 'next' } })
})

it('定位等待期间恢复播放尚未收到playing时，迟到定位也不能取消新的播放', async () => {
  let resolve!: (lines: never[]) => void
  vi.spyOn(localMusicService, 'getLyrics').mockReturnValueOnce(new Promise(done => { resolve = done }))
  const loading = useShuangeStore.getState().loadIndex(1)
  usePlayerStore.getState().play()
  // 原曲尚在 AudioContext/媒体起播窗口，playing 事件还未返回。
  expect(usePlayerStore.getState().status).toBe('paused')
  h.load.mockClear()
  resolve([])
  await loading
  expect(h.load).not.toHaveBeenCalled()
  expect(usePlayerStore.getState().currentTrack?.id).toBe('first')
  expect(useShuangeStore.getState()).toMatchObject({ index: 0, loading: false })
  h.callbacks.onStatus?.('playing')
  expect(usePlayerStore.getState().status).toBe('playing')
})

it('定位等待中的同曲静音重载也是新选择，不能被误判为暂停后切卡', async () => {
  let resolve!: (lines: never[]) => void
  vi.spyOn(localMusicService, 'getLyrics').mockReturnValueOnce(new Promise(done => { resolve = done }))
  const loading = useShuangeStore.getState().loadIndex(1)
  await usePlayerStore.getState().loadTrack(track, { autoplay: false })
  expect(usePlayerStore.getState().status).toBe('paused')
  h.load.mockClear()
  resolve([])
  await loading
  expect(h.load).not.toHaveBeenCalled()
  expect(usePlayerStore.getState()).toMatchObject({ currentTrack: track, status: 'paused' })
  expect(useShuangeStore.getState()).toMatchObject({ index: 0, loading: false })
})
