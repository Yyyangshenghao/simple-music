import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useBilibiliCoverStore } from '../stores/bilibili-covers'
import { usePlayerStore } from '../stores/player'
import { useLyricsSourceStore } from '../stores/lyrics-source'
import { useLyricsStore } from '../stores/lyrics'
import { useSettingsStore } from '../stores/settings'
import { useProviderStore } from '../stores/providers'
import { useGameModeStore } from '../stores/game-mode'
import { advanceProviderAccountSession } from './provider-account-session'
import { initLyricsLoader } from './lyrics-loader'

const h = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('./lyrics-source-query', () => ({ queryLyricsSource: h.query, candidateAvailability: () => ({ status: 'idle' }) }))

const result = { source: 'netease', main: [{ time: 1, text: '甲乙' }], aligned: [], roma: [], wordLines: [] }
const flush = async () => { for (let index = 0; index < 20; index++) await Promise.resolve() }
let stop: (() => void) | undefined
beforeEach(() => {
  vi.resetAllMocks()
  usePlayerStore.setState({ currentTrack: {
    id: 'BVtest', source: 'bilibili', provider: 'bilibili', type: 'song',
    name: '周杰伦《晴天》', artist: 'UP', artists: [], duration: 269_000,
  }, resolvedTrack: null })
  useGameModeStore.setState({ enabled: false })
  useLyricsSourceStore.setState({ sourceOrder: ['netease', 'qq', 'amll', 'kugou', 'apple', 'qishui'], remembered: {} })
})
afterEach(() => { stop?.(); stop = undefined })

it('B 站只查询首选歌词来源，等待期间不并发启动其余来源，命中即停', async () => {
  let resolve!: (value: unknown) => void
  h.query.mockReturnValue(new Promise(done => { resolve = done }))
  stop = initLyricsLoader()
  await flush()
  expect(h.query).toHaveBeenCalledOnce()
  expect(h.query.mock.calls[0][1]).toBe('netease')
  resolve({ status: 'ready', result })
  await flush()
  expect(h.query).toHaveBeenCalledOnce()
  expect(useLyricsStore.getState().lines).toBe(result.main)
})

it('首选未命中才查下一个来源，命中后不继续查 AMLL 和酷狗', async () => {
  h.query.mockResolvedValueOnce({ status: 'empty' }).mockResolvedValue({ status: 'ready', result: { ...result, source: 'qq' } })
  stop = initLyricsLoader()
  await flush()
  expect(h.query.mock.calls.map(call => call[1])).toEqual(['netease', 'qq'])
  expect(useLyricsSourceStore.getState().appliedOrigin).toBe('qq')
})


it('人工确认歌曲后宿主重新取词，旧歌词不会继续保留', async () => {
  h.query.mockResolvedValueOnce({ status: 'ready', result }).mockResolvedValue({ status: 'ready', result: { ...result, main: [{ time: 1, text: '已确认歌曲的歌词' }] } })
  stop = initLyricsLoader()
  await flush()
  expect(useLyricsStore.getState().lines).toBe(result.main)
  const track = usePlayerStore.getState().currentTrack!
  useBilibiliCoverStore.getState().rememberIdentity(track, {
    id: 'confirmed', source: 'netease', provider: 'netease', type: 'song', name: '晴天',
    artist: '周杰伦', artists: [{ id: 1, name: '周杰伦' }], duration: 269_000,
  }, true)
  await flush()
  expect(h.query).toHaveBeenCalledTimes(2)
  expect(useLyricsStore.getState().lines[0].text).toBe('已确认歌曲的歌词')
})


it('没有歌词来源顺序且全部平台停用时，B 站仍按系统游客来源查词', async () => {
  useLyricsSourceStore.setState({ sourceOrder: null })
  useSettingsStore.setState({ lyricsGuestSources: { netease: false, qq: false }, lyricsPlatformSources: { netease: false, qq: false, apple: false, qishui: false } })
  const byId = useProviderStore.getState().byId
  useProviderStore.setState({ byId: Object.fromEntries(Object.entries(byId).map(([source, state]) => [source, { ...state, enabled: false, auth: 'anonymous' }])) as typeof byId })
  h.query.mockResolvedValue({ status: 'ready', result })
  stop = initLyricsLoader()
  await flush()
  expect(h.query).toHaveBeenCalledOnce()
  expect(h.query.mock.calls[0][1]).toBe('netease')
  expect(useLyricsStore.getState().lines).toBe(result.main)
})


it('B 站系统游客查询不会因无关账号或平台开关变化取消重发', async () => {
  let resolve!: (value: unknown) => void
  h.query.mockReturnValue(new Promise(done => { resolve = done }))
  stop = initLyricsLoader()
  await flush()
  const signal = h.query.mock.calls[0][3] as AbortSignal
  advanceProviderAccountSession('netease')
  advanceProviderAccountSession('apple')
  const byId = useProviderStore.getState().byId
  useProviderStore.setState({ byId: { ...byId, netease: { enabled: !byId.netease.enabled, auth: 'anonymous' }, apple: { enabled: !byId.apple.enabled, auth: 'anonymous' } } })
  useSettingsStore.setState({ lyricsGuestSources: { netease: true, qq: true }, lyricsPlatformSources: { netease: true, qq: true, apple: true, qishui: true } })
  expect(signal.aborted).toBe(false)
  resolve({ status: 'ready', result })
  await flush()
  expect(h.query).toHaveBeenCalledOnce()
  expect(useLyricsStore.getState().lines).toBe(result.main)
})

it('B 站自动游客来源不会采用全局顺序中的 Apple 和汽水账号来源', async () => {
  useLyricsSourceStore.setState({ sourceOrder: ['apple', 'qishui', 'qq', 'netease', 'amll', 'kugou'] })
  h.query.mockResolvedValue({ status: 'ready', result: { ...result, source: 'qq' } })
  stop = initLyricsLoader()
  await flush()
  expect(h.query.mock.calls.map(call => call[1])).toEqual(['qq'])
})

it('B 站手选 Apple 暂不可用后重新登录时恢复记住的来源', async () => {
  useSettingsStore.setState({ lyricsPlatformSources: { netease: false, qq: false, apple: true, qishui: false } })
  useProviderStore.setState({ playbackOrder: ['apple', 'netease', 'qq'], byId: { ...useProviderStore.getState().byId, apple: { enabled: true, auth: 'authenticated' } } })
  useLyricsSourceStore.setState({ remembered: { 'bilibili:BVtest': { origin: 'apple', name: '晴天', artist: '周杰伦' } } })
  h.query.mockImplementation(async (_track, origin) => {
    if (origin !== 'apple') return { status: 'ready', result }
    const state = useProviderStore.getState().byId.apple
    return state.enabled && state.auth === 'authenticated'
      ? { status: 'ready', result: { ...result, source: 'apple' } }
      : { status: 'unavailable', message: 'Apple Music 未启用' }
  })
  stop = initLyricsLoader()
  await flush()
  expect(useLyricsSourceStore.getState().appliedOrigin).toBe('apple')
  useProviderStore.setState({ byId: { ...useProviderStore.getState().byId, apple: { enabled: false, auth: 'anonymous' } } })
  await flush()
  expect(useLyricsSourceStore.getState().appliedOrigin).toBe('netease')
  advanceProviderAccountSession('apple')
  useProviderStore.setState({ byId: { ...useProviderStore.getState().byId, apple: { enabled: true, auth: 'authenticated' } } })
  await flush()
  expect(useLyricsSourceStore.getState().appliedOrigin).toBe('apple')
  expect(h.query.mock.calls.map(call => call[1])).toEqual(['apple', 'apple', 'netease', 'apple'])
})
