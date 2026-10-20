import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { Track } from '../../types/domain'
import { ShuangeCard } from './ShuangeCard'

const h = vi.hoisted(() => ({ quickAdd: vi.fn(), next: vi.fn(), like: vi.fn(), playFull: vi.fn() }))
const track: Track = { provider: 'netease', source: 'netease', type: 'song', id: 12, name: '刷到的歌曲', artist: '歌手', artists: [] }
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => [initial, vi.fn()],
  useRef: (current: unknown) => ({ current }),
  useEffect: () => {},
}))
vi.mock('../../stores/shuange', () => ({ SHUANGE_COVER_PX: 640, useShuangeStore: Object.assign((select: (state: unknown) => unknown) => select({ index: 0, offset: { startSec: 0, endSec: 30 }, next: h.next, playFullCurrent: h.playFull }), { getState: () => ({ toggleLike: h.like }) }) }))
vi.mock('../../stores/player', () => ({ usePlayerStore: (select: (state: unknown) => unknown) => select({ currentTrack: track, status: 'playing', duration: 200 }) }))
vi.mock('../../stores/sleep-timer', () => ({ useSleepTimerStore: (select: (state: unknown) => unknown) => select({ phase: 'idle' }) }))
vi.mock('../../stores/lyrics', () => ({ useLyricsStore: (select: (state: unknown) => unknown) => select({ lines: [], currentIndex: -1 }) }))
vi.mock('../../stores/likes', () => ({ likeKeyOf: () => 'track', useLikesStore: (select: (state: unknown) => unknown) => select({ likedByKey: {}, revision: 0, supports: () => true }) }))
vi.mock('../../stores/track-actions', () => ({ useTrackActionsStore: { getState: () => ({ toggleQuickAdd: h.quickAdd }) }, anchorOf: () => ({ x: 1, y: 2, width: 42, height: 42 }) }))

type NodeElement = ReactElement<{ children?: ReactNode; 'aria-label'?: string; onClick?: (event: unknown) => void }>
function nodes(node: ReactNode): NodeElement[] {
  return Children.toArray(node).flatMap(child => isValidElement<{ children?: ReactNode }>(child) ? [child as NodeElement, ...nodes(child.props.children)] : [])
}
beforeEach(() => vi.clearAllMocks())

it('刷歌直接收藏展示中的歌曲，不触发平台喜欢、切歌或全曲播放', () => {
  const buttons = nodes(ShuangeCard({ track, switching: false, onExit: vi.fn() }))
  const add = buttons.find(node => node.props['aria-label'] === '加入应用歌单')!
  expect(add).toBeDefined()
  expect(buttons.find(node => node.props['aria-label'] === '喜欢')).toBeDefined()
  add.props.onClick!({ currentTarget: {} })
  expect(h.quickAdd).toHaveBeenCalledWith(track, { x: 1, y: 2, width: 42, height: 42 })
  expect(h.like).not.toHaveBeenCalled()
  expect(h.next).not.toHaveBeenCalled()
  expect(h.playFull).not.toHaveBeenCalled()
})
