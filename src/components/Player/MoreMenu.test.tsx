import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LyricOrigin } from '../../types/lyrics-source'
import { MoreMenu } from './MoreMenu'
import { useNavigationStore } from '../../stores/navigation'

const h = vi.hoisted(() => ({
  track: { id: 1, source: 'netease' } as { id: unknown; source: string } | null,
  lyrics: { trackKey: 'netease:1', source: 'netease', loading: false },
  sources: { appliedOrigin: 'qq' as LyricOrigin | null, requestedOrigin: 'netease' },
  show: vi.fn(), setOpen: vi.fn(),
  enabled: false, effects: [] as Array<() => unknown>, loadQualities: vi.fn(),
}))

vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: () => [true, h.setOpen],
  useRef: () => ({ current: null }),
  useEffect: (effect: () => unknown) => { h.effects.push(effect) },
  useLayoutEffect: () => {},
}))
vi.mock('react-dom', async original => ({ ...await original<typeof import('react-dom')>(), createPortal: (node: ReactNode) => node }))
vi.stubGlobal('document', {})
vi.mock('../../hooks/useMotion', () => ({ useMotion: () => true }))
vi.mock('../../lib/track-qualities', () => ({ loadTrackQualities: h.loadQualities, peekTrackQualities: () => undefined }))
vi.mock('../../stores/player', () => ({ usePlayerStore: (select: (state: unknown) => unknown) => select({ currentTrack: h.track, rate: 1 }) }))
vi.mock('../../stores/karaoke', () => ({ useKaraokeStore: (select: (state: unknown) => unknown) => select({ jobs: [] }) }))
vi.mock('../../stores/lyrics', () => ({ useLyricsStore: (select: (state: typeof h.lyrics) => unknown) => select(h.lyrics) }))
vi.mock('../../stores/lyrics-source', () => ({ useLyricsSourceStore: (select: (state: typeof h.sources) => unknown) => select(h.sources) }))
vi.mock('../../stores/providers', () => ({ useProviderStore: (select: (state: unknown) => unknown) => select({ byId: Object.fromEntries(['netease', 'qq', 'apple', 'kugou', 'qishui', 'bilibili'].map(source => [source, { enabled: h.enabled, auth: 'authenticated' }])) }) }))
vi.mock('../../stores/sleep-timer', () => ({ useSleepTimerStore: (select: (state: unknown) => unknown) => select({ phase: 'idle' }) }))
vi.mock('../../stores/lyrics-source-dialog', () => ({ useLyricsSourceDialogStore: Object.assign(() => false, { getState: () => ({ show: h.show }) }) }))

type NodeElement = ReactElement<{ children?: ReactNode; title?: string; onClick?: () => void }>
function nodes(node: ReactNode): NodeElement[] {
  return Children.toArray(node).flatMap(child => isValidElement<{ children?: ReactNode }>(child) ? [child as NodeElement, ...nodes(child.props.children)] : [])
}
function text(node: ReactNode): string {
  return Children.toArray(node).map(child => isValidElement<{ children?: ReactNode }>(child) ? text(child.props.children) : String(child)).join('')
}
function sourceRow() {
  return nodes(MoreMenu()).find(node => node.type === 'button' && text(node.props.children).startsWith('歌词来源'))
}

beforeEach(() => {
  vi.clearAllMocks()
  h.enabled = false
  h.effects = []
  h.loadQualities.mockResolvedValue([])
  vi.stubGlobal('document', {})
  h.track = { id: 1, source: 'netease' }
  Object.assign(h.lyrics, { trackKey: 'netease:1', source: 'netease', loading: false })
  Object.assign(h.sources, { appliedOrigin: 'qq', requestedOrigin: 'netease' })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('切歌后的音质请求', () => {
  it.each(['netease', 'qq'])('%s 仅保留 QQ 自动预取，网易不额外逐档取链', async source => {
    vi.useFakeTimers()
    vi.stubGlobal('window', { setTimeout, clearTimeout, addEventListener: vi.fn(), removeEventListener: vi.fn() })
    h.enabled = true
    h.track = { id: 1, source }
    MoreMenu()
    for (const effect of h.effects) effect()
    await vi.advanceTimersByTimeAsync(1500)
    expect(h.loadQualities).toHaveBeenCalledTimes(source === 'qq' ? 1 : 0)
  })
})

describe('更多菜单的当前歌词来源', () => {
  it('当前网易歌曲可打开原平台评论，关闭更多菜单', () => {
    const comment = nodes(MoreMenu()).find(node => node.type === 'button' && text(node.props.children) === '歌曲评论')
    expect(comment).toBeDefined()
    comment!.props.onClick!()
    expect(h.setOpen).toHaveBeenCalledWith(false)
    expect(useNavigationStore.getState().currentView).toEqual({ type: 'song-comments', track: h.track })
  })

  it.each(['apple', 'local', 'kugou', 'qishui', 'bilibili'])('%s 不显示未接入的评论入口', source => {
    h.track = { id: 1, source }
    expect(nodes(MoreMenu()).some(node => node.type === 'button' && text(node.props.children) === '歌曲评论')).toBe(false)
  })
  it.each([
    ['netease', '网易云音乐'], ['qq', 'QQ 音乐'], ['apple', 'Apple Music'],
    ['local', '本地歌词'], ['amll', 'AMLL 逐字歌词库'], ['kugou', '酷狗音乐'],
  ] as const)('显示实际应用的 %s 来源，忽略偏好与匹配平台', (origin, label) => {
    h.sources.appliedOrigin = origin
    const row = sourceRow()!
    expect(text(row.props.children)).toBe(`歌词来源${label}`)
    expect(nodes(row).some(node => node.props.title === label)).toBe(true)
  })

  it('加载中和无歌词时不把偏好显示为实际来源', () => {
    h.lyrics.loading = true
    expect(text(sourceRow()!.props.children)).toBe('歌词来源正在加载…')
    h.lyrics.loading = false
    h.sources.appliedOrigin = null
    expect(text(sourceRow()!.props.children)).toBe('歌词来源暂无歌词')
  })

  it('切歌期间不展示上一首来源，无歌曲时隐藏入口', () => {
    h.track = { id: 2, source: 'netease' }
    expect(text(sourceRow()!.props.children)).toBe('歌词来源暂无歌词')
    h.track = null
    expect(sourceRow()).toBeUndefined()
  })

  it('点击仍关闭更多菜单并打开歌词选择', () => {
    sourceRow()!.props.onClick!()
    expect(h.setOpen).toHaveBeenCalledWith(false)
    expect(h.show).toHaveBeenCalledOnce()
  })
})
