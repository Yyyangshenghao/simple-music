import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  onMiniPlayerControl: undefined as ((payload: { action: string; value?: number }) => void) | undefined,
  setMiniPlayerEnabled: vi.fn(),
  toggle: vi.fn(), volume: vi.fn(), next: vi.fn(), prev: vi.fn(),
  shuangeActive: false, feedNext: vi.fn(), feedPrev: vi.fn()
}))

vi.mock('react', () => ({
  useEffect: (effect: () => void | (() => void)) => effect()
}))

vi.mock('../stores/window', () => ({
  useWindowStore: { getState: () => ({ setState: vi.fn() }) }
}))

vi.mock('../stores/player', () => ({
  usePlayerStore: {
    getState: () => ({ toggle: harness.toggle, setVolume: harness.volume, seek: vi.fn(), volume: 0.5 })
  }
}))

vi.mock('../stores/playlist', () => ({
  usePlaylistStore: { getState: () => ({ next: harness.next, prev: harness.prev }) }
}))
vi.mock('../stores/shuange', () => ({ useShuangeStore: { getState: () => ({ active: harness.shuangeActive, next: harness.feedNext, prev: harness.feedPrev }) } }))

vi.mock('../stores/settings', () => ({
  useSettingsStore: {
    getState: () => ({ setMiniPlayerEnabled: harness.setMiniPlayerEnabled })
  }
}))

import { useDesktopBridge } from './useDesktopBridge'

describe('桌面桥接的迷你播放器状态同步', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    harness.shuangeActive = false
    harness.onMiniPlayerControl = undefined
    harness.setMiniPlayerEnabled.mockReset()
    vi.stubGlobal('window', {
      desktop: {
        onStateChange: vi.fn(() => vi.fn()),
        getState: vi.fn(() => Promise.resolve({})),
        onHotkey: vi.fn(() => vi.fn()),
        onMiniPlayerControl: vi.fn((callback: (payload: { action: string; value?: number }) => void) => {
          harness.onMiniPlayerControl = callback
          return vi.fn()
        })
      }
    })
  })

  it('收到 sync-off 时仅把持久化设置落回关闭', () => {
    useDesktopBridge()

    harness.onMiniPlayerControl?.({ action: 'sync-off' })

    expect(harness.setMiniPlayerEnabled).toHaveBeenCalledOnce()
    expect(harness.setMiniPlayerEnabled).toHaveBeenCalledWith(false)
  })

  it('迷你播放器和托盘上下首在刷歌期间只切换 feed，退出后恢复普通队列', () => {
    useDesktopBridge()
    harness.shuangeActive = true
    harness.onMiniPlayerControl?.({ action: 'next' })
    harness.onMiniPlayerControl?.({ action: 'prev' })
    expect(harness.feedNext).toHaveBeenCalledOnce()
    expect(harness.feedPrev).toHaveBeenCalledOnce()
    expect(harness.next).not.toHaveBeenCalled()
    expect(harness.prev).not.toHaveBeenCalled()
    harness.shuangeActive = false
    harness.onMiniPlayerControl?.({ action: 'prev' })
    expect(harness.prev).toHaveBeenCalledOnce()
  })

  it('托盘基础命令调用播放器与队列，音量命令保持原数值范围', () => {
    useDesktopBridge()
    for (const action of ['play-pause', 'next', 'prev', 'volume-up', 'volume-down']) harness.onMiniPlayerControl?.({ action })
    harness.onMiniPlayerControl?.({ action: 'volume', value: 2 })
    expect(harness.toggle).toHaveBeenCalledOnce()
    expect(harness.next).toHaveBeenCalledOnce()
    expect(harness.prev).toHaveBeenCalledOnce()
    expect(harness.volume.mock.calls).toEqual([[0.55], [0.45], [1]])
  })
})
