import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../types/domain'

const harness = vi.hoisted(() => ({ cleanup: undefined as (() => void) | undefined, openQuickAdd: vi.fn(), setState: vi.fn() }))
vi.mock('react', () => ({ useEffect: (effect: () => () => void) => { harness.cleanup = effect() } }))
vi.mock('../stores/window', () => ({ useWindowStore: { getState: () => ({ setState: harness.setState }) } }))
vi.mock('../stores/track-actions', () => ({ useTrackActionsStore: { getState: () => ({ openQuickAdd: harness.openQuickAdd }) } }))
vi.mock('../lib/game-mode-sync', () => ({ initGameModeSync: vi.fn() }))

import { useDesktopBridge } from './useDesktopBridge'

describe('迷你条收藏意图在主窗口打开选择器', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => {
    harness.cleanup?.()
    vi.unstubAllGlobals()
  })

  it('直接使用点击时曲目快照，订阅销毁后停止消费', () => {
    let receive!: (track: Track) => void
    const off = vi.fn()
    vi.stubGlobal('window', { innerWidth: 1000, innerHeight: 800, desktop: {
      onStateChange: () => vi.fn(), getState: async () => ({}),
      onMiniPlayerAddToPlaylist: (callback: typeof receive) => { receive = callback; return off }
    } })
    useDesktopBridge()
    const clicked: Track = { provider: 'netease', source: 'netease', type: 'song', id: 1, name: '点击时歌曲', artist: '歌手', artists: [] }
    receive(clicked)
    expect(harness.openQuickAdd).toHaveBeenCalledWith(clicked, { x: 360, y: 220, width: 0, height: 0 })
    harness.cleanup?.()
    harness.cleanup = undefined
    expect(off).toHaveBeenCalledOnce()
  })
})
