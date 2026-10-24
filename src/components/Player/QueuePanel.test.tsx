import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../../types/domain'
import { QueuePanel } from './QueuePanel'

const h = vi.hoisted(() => ({
  effects: [] as (() => void)[], refs: [] as { current: unknown }[], stateIndex: 0,
  setOpen: vi.fn(), quickAdd: vi.fn(), playAt: vi.fn(),
}))
const tracks: Track[] = [1, 2].map(id => ({ provider: 'netease', source: 'netease', type: 'song', id, name: `歌曲${id}`, artist: '歌手', artists: [] }))
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => [h.stateIndex++ === 0 ? true : initial, h.setOpen],
  useRef: (current: unknown) => { const ref = { current }; h.refs.push(ref); return ref },
  useMemo: (factory: () => unknown) => factory(),
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void) => { h.effects.push(effect) },
}))
vi.mock('../../stores/playlist', () => ({ usePlaylistStore: (select: (state: unknown) => unknown) => select({ queue: tracks, queueIndex: 0, shuffleOrder: [], playAt: h.playAt }) }))
vi.mock('../../stores/settings', () => ({ useSettingsStore: (select: (state: unknown) => unknown) => select({ playMode: 'list' }) }))
vi.mock('../../stores/player', () => ({ usePlayerStore: (select: (state: unknown) => unknown) => select({ status: 'paused', currentTrack: tracks[0] }) }))
vi.mock('../../stores/providers', () => ({ useProviderStore: (select: (state: unknown) => unknown) => select({ byId: { qq: { enabled: false, auth: 'anonymous' } } }) }))
vi.mock('../../stores/track-actions', () => ({ useTrackActionsStore: { getState: () => ({ toggleQuickAdd: h.quickAdd }) }, anchorOf: () => ({ x: 10, y: 20, width: 26, height: 26 }) }))
vi.mock('./QueueDiscovery', () => ({ QueueDiscovery: () => null }))
vi.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => false }))
vi.mock('./useQueueDrag', () => ({ useQueueDrag: () => ({ drag: null, onRowPointerDown: vi.fn(), rowShift: () => 0, ghost: null, strips: [] }) }))

type NodeElement = ReactElement<{ children?: ReactNode; ariaLabel?: string; 'aria-label'?: string; onClick?: (event: unknown) => void; renderRow?: (index: number) => ReactNode }>
function nodes(node: ReactNode): NodeElement[] {
  return Children.toArray(node).flatMap(child => isValidElement<{ children?: ReactNode }>(child) ? [child as NodeElement, ...nodes(child.props.children)] : [])
}

beforeEach(() => { vi.clearAllMocks(); h.effects = []; h.refs = []; h.stateIndex = 0 })

describe('队列歌曲收藏', () => {
  it('当前和非当前歌曲均可加入歌单，使用该行歌曲且不会切歌', () => {
    const tree = QueuePanel({})
    const list = nodes(tree).find(node => node.props.renderRow)!
    for (let index = 0; index < tracks.length; index++) {
      const row = list.props.renderRow!(index)
      const add = nodes(row).find(node => node.props['aria-label'] === `将 歌曲${index + 1} 加入歌单`)!
      expect(add).toBeDefined()
      add.props.onClick!({ currentTarget: {} })
      expect(h.quickAdd).toHaveBeenLastCalledWith(tracks[index], { x: 10, y: 20, width: 26, height: 26 })
    }
    expect(h.playAt).not.toHaveBeenCalled()
  })

  it('点击全局收藏层保留队列，真正点击外部才关闭', () => {
    const listeners = new Map<string, (event: unknown) => void>()
    vi.stubGlobal('window', { addEventListener: (key: string, handler: (event: unknown) => void) => listeners.set(key, handler), removeEventListener: vi.fn() })
    class Target { constructor(private inside: boolean) {} closest(selector: string) { return selector === '[data-track-action-layer]' && this.inside ? this : null } }
    vi.stubGlobal('Element', Target)
    try {
      QueuePanel({})
      h.refs[0].current = { contains: () => false } // rootRef
      h.effects[0]()
      listeners.get('pointerdown')!({ target: new Target(true) })
      expect(h.setOpen).not.toHaveBeenCalled()
      listeners.get('pointerdown')!({ target: new Target(false) })
      expect(h.setOpen).toHaveBeenCalledWith(false)
    } finally { vi.unstubAllGlobals() }
  })
})
