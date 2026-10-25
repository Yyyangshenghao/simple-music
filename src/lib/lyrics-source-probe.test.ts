import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useLyricsSourceStore } from '../stores/lyrics-source'
import { useLyricsStore } from '../stores/lyrics'
import { usePlayerStore } from '../stores/player'
import { queryLyricsSource } from './lyrics-source-query'
import { createLyricsSourceProbe } from './lyrics-source-probe'

vi.mock('./lyrics-source-query', () => ({ queryLyricsSource: vi.fn() }))
beforeEach(() => {
  vi.resetAllMocks()
  useLyricsSourceStore.setState({ probes: {} })
})
afterEach(() => vi.restoreAllMocks())

it('测试绕过缓存且不改变播放、歌词与按歌记忆，快照只包含诊断信息', async () => {
  const player = usePlayerStore.getState()
  const lyrics = useLyricsStore.getState()
  const remembered = useLyricsSourceStore.getState().remembered
  vi.mocked(queryLyricsSource).mockResolvedValue({ status: 'ready', result: { source: 'netease', main: [{ time: 0, text: '测试歌词' }], aligned: [], roma: [], wordLines: [] } })
  const probe = createLyricsSourceProbe()
  await probe.test('netease', 'sunny')
  expect(queryLyricsSource).toHaveBeenCalledWith(expect.objectContaining({ id: '186016', duration: 269000 }), 'netease', ['netease', 'qq'], expect.any(AbortSignal), undefined, { probe: true })
  expect(usePlayerStore.getState()).toBe(player)
  expect(useLyricsStore.getState()).toBe(lyrics)
  expect(useLyricsSourceStore.getState().remembered).toBe(remembered)
  expect(useLyricsSourceStore.getState().probes.netease).toMatchObject({ status: 'ready', sample: '晴天' })
  expect(JSON.stringify(useLyricsSourceStore.getState().probes)).not.toContain('测试歌词')
  probe.stop()
})

it('同一来源测试去重，宿主停止后忽略晚到结果', async () => {
  let resolve!: (value: { status: 'empty' }) => void
  vi.mocked(queryLyricsSource).mockReturnValue(new Promise(done => { resolve = done }))
  const probe = createLyricsSourceProbe()
  const pending = probe.test('qq', 'ocean')
  await probe.test('qq', 'sunny')
  expect(queryLyricsSource).toHaveBeenCalledOnce()
  const signal = vi.mocked(queryLyricsSource).mock.calls[0][3]!
  probe.stop()
  expect(signal.aborted).toBe(true)
  resolve({ status: 'empty' })
  await pending
  expect(useLyricsSourceStore.getState().probes.qq?.status).toBe('loading')
})
