import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { usePlayerStore } from '../stores/player'
import { useLyricsSourceStore } from '../stores/lyrics-source'
import { useLyricsStore } from '../stores/lyrics'
import { useGameModeStore } from '../stores/game-mode'
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
