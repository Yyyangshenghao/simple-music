import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LyricOrigin } from '../../types/lyrics-source'
import { MoreMenu } from './MoreMenu'

const h = vi.hoisted(() => ({
  track: { id: 1, source: 'netease' } as { id: unknown; source: string } | null,
  lyrics: { trackKey: 'netease:1', source: 'netease', loading: false },
  sources: { appliedOrigin: 'qq' as LyricOrigin | null, requestedOrigin: 'netease' },
  show: vi.fn(), setOpen: vi.fn(),
}))

vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: () => [true, h.setOpen],
  useRef: () => ({ current: null }),
  useEffect: () => {},
}))
vi.mock('../../stores/player', () => ({ usePlayerStore: (select: (state: unknown) => unknown) => select({ currentTrack: h.track, rate: 1 }) }))
vi.mock('../../stores/lyrics', () => ({ useLyricsStore: (select: (state: typeof h.lyrics) => unknown) => select(h.lyrics) }))
vi.mock('../../stores/lyrics-source', () => ({ useLyricsSourceStore: (select: (state: typeof h.sources) => unknown) => select(h.sources) }))
vi.mock('../../stores/providers', () => ({ useProviderStore: (select: (state: unknown) => unknown) => select({ byId: { netease: { enabled: false } } }) }))
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
  h.track = { id: 1, source: 'netease' }
  Object.assign(h.lyrics, { trackKey: 'netease:1', source: 'netease', loading: false })
  Object.assign(h.sources, { appliedOrigin: 'qq', requestedOrigin: 'netease' })
})

describe('更多菜单的当前歌词来源', () => {
  it.each([
    ['netease', '网易云音乐'], ['qq', 'QQ 音乐'], ['apple', 'Apple Music'],
    ['local', '本地歌词'], ['amll', 'AMLL 逐字歌词库'], ['kugou', '酷狗歌词库'],
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
