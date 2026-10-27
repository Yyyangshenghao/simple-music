import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AccompanimentButton } from './AccompanimentButton'
import type { Track } from '../../types/domain'
import type { KaraokeJob } from '../../lib/karaoke/queue'
import type { Accompaniment } from '../../types/karaoke'

const h = vi.hoisted(() => ({
  player: { currentTrack: null as Track | null, accompaniment: null as Track | null, selectAccompaniment: vi.fn() },
  karaoke: { items: [] as Accompaniment[], jobs: [] as KaraokeJob[], played: {} as Record<string, number> },
  open: false, setOpen: vi.fn(), setHolding: vi.fn(),
  hold: { current: { fired: false, busy: false } as { timer?: ReturnType<typeof setTimeout>; fired: boolean; busy: boolean } },
}))
// 组件内 useState 依次为 open、fresh、holding；长按状态的 ref 跨渲染保留。
let stateCall = 0
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: () => { const i = stateCall++ % 3; return i === 0 ? [h.open, h.setOpen] : i === 1 ? [false, vi.fn()] : [false, h.setHolding] },
  useRef: (value: unknown) => value && typeof value === 'object' && 'fired' in value ? h.hold : { current: value }, useEffect: () => {}, useLayoutEffect: () => {} }))
vi.mock('../../stores/player', () => ({ usePlayerStore: Object.assign((select: (state: typeof h.player) => unknown) => select(h.player), { getState: () => h.player }) }))
vi.mock('../../stores/settings', () => ({ useSettingsStore: (select: (state: { karaokeModel: string }) => unknown) => select({ karaokeModel: 'kara2' }) }))
vi.mock('../../stores/toast', () => ({ useToastStore: { getState: () => ({ show: vi.fn() }) } }))
vi.mock('../../hooks/useMotion', () => ({ useMotion: () => false }))
vi.mock('react-dom', () => ({ createPortal: (node: unknown) => node }))
vi.mock('../../stores/karaoke', () => ({ useKaraokeStore: (select: (state: typeof h.karaoke) => unknown) => select(h.karaoke) }))

const track: Track = { id: 1, source: 'netease', provider: 'netease', type: 'song', name: '歌曲', artist: '艺人', artists: [] }
const saved = (id: string, generatedAt: number, available = true): Accompaniment => ({ id: id.repeat(40), key: 'netease:1', track, model: 'hq3', available, directory: '/songs', fileName: 'a.wav', bytes: 1, generatedAt })
beforeEach(() => {
  h.player.currentTrack = track; h.player.accompaniment = null; h.karaoke.jobs = []; h.karaoke.items = []; h.karaoke.played = {}; h.open = false
  h.hold.current = { fired: false, busy: false }; stateCall = 0; vi.clearAllMocks()
  h.player.selectAccompaniment.mockResolvedValue(undefined)
})
afterEach(() => { vi.useRealTimers() })
const button = () => { stateCall = 0; return AccompanimentButton().props.children[0] }
const children = () => [button().props.children].flat().filter(Boolean)
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }

it('没有伴奏时点按打开弹窗，不改变播放', () => {
  h.karaoke.items = [saved('a', 1, false)]
  expect(button().props).toMatchObject({ disabled: false, 'aria-pressed': false, 'aria-haspopup': 'dialog', 'aria-expanded': false, title: '选择或生成伴奏版本' })
  button().props.onClick()
  expect(h.setOpen).toHaveBeenCalledOnce()
  expect(h.player.selectAccompaniment).not.toHaveBeenCalled()
})

it('有伴奏且都没播放过时，点按在原唱与最新生成的伴奏之间切换', async () => {
  h.karaoke.items = [saved('a', 1), saved('b', 3), saved('c', 5, false)]
  expect(button().props.title).toBe('切换到伴奏 · 长按管理')
  button().props.onClick(); await flush()
  expect(h.player.selectAccompaniment).toHaveBeenLastCalledWith('b'.repeat(40), 'netease:1')
  h.player.accompaniment = { ...track, source: 'local', id: `karaoke:${'a'.repeat(40)}` }
  expect(button().props).toMatchObject({ 'aria-pressed': true, 'data-active': true, title: '切回原唱 · 长按管理' })
  button().props.onClick(); await flush()
  expect(h.player.selectAccompaniment).toHaveBeenLastCalledWith(null, 'netease:1')
  expect(h.setOpen).not.toHaveBeenCalled()
})

it('长按打开弹窗且松手不再切换，短按不打开', async () => {
  vi.useFakeTimers()
  h.karaoke.items = [saved('a', 1)]
  button().props.onPointerDown({ button: 0 })
  expect(h.setHolding).toHaveBeenLastCalledWith(true)
  vi.advanceTimersByTime(450)
  expect(h.setOpen).toHaveBeenCalledWith(true)
  button().props.onPointerUp()
  button().props.onClick(); await flush()
  expect(h.player.selectAccompaniment).not.toHaveBeenCalled()

  h.setOpen.mockClear()
  button().props.onPointerDown({ button: 0 })
  vi.advanceTimersByTime(200)
  button().props.onPointerUp()
  vi.advanceTimersByTime(500)
  expect(h.setOpen).not.toHaveBeenCalled()
  button().props.onClick(); await flush()
  expect(h.player.selectAccompaniment).toHaveBeenCalledOnce()
})

it('右键直接打开弹窗', () => {
  h.karaoke.items = [saved('a', 1)]
  const preventDefault = vi.fn()
  button().props.onContextMenu({ preventDefault })
  expect(preventDefault).toHaveBeenCalled()
  expect(h.setOpen).toHaveBeenCalledWith(true)
})

it('未选曲和 Apple Music 显示明确的不可用原因', () => {
  h.player.currentTrack = null
  expect(button().props).toMatchObject({ disabled: true, title: '请先播放歌曲' })
  h.player.currentTrack = { ...track, source: 'apple', provider: 'apple' }
  expect(button().props).toMatchObject({ disabled: true, title: 'Apple Music 暂不支持伴奏模式' })
})

it('当前歌曲在后台生成时按钮显示进度环与阶段提示，失败任务不显示', () => {
  h.karaoke.jobs = [{ id: 'job', model: 'hq3', track, phase: 'separating', progress: 0.42, directory: '/songs' }]
  expect(button().props).toMatchObject({ 'data-busy': true, title: '正在生成伴奏 42%' })
  expect(children().some(child => child.props?.['data-indeterminate'] === false)).toBe(true)
  h.karaoke.jobs[0].phase = 'queued'
  expect(button().props.title).toBe('等待生成')
  expect(children().some(child => child.props?.['data-indeterminate'] === true)).toBe(true)
  h.karaoke.jobs[0].phase = 'failed'
  expect(button().props).toMatchObject({ 'data-busy': false, title: '选择或生成伴奏版本' })
})

it('点按优先切到最近播放过的伴奏，而不是最新生成的', async () => {
  h.karaoke.items = [saved('a', 1), saved('b', 3)]
  h.karaoke.played = { ['a'.repeat(40)]: 100 }
  button().props.onClick(); await flush()
  expect(h.player.selectAccompaniment).toHaveBeenLastCalledWith('a'.repeat(40), 'netease:1')
})
