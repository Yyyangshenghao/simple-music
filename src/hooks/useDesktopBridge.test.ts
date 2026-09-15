import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  onMiniPlayerControl: undefined as ((payload: { action: string; value?: number }) => void) | undefined,
  setMiniPlayerEnabled: vi.fn()
}))

vi.mock('react', () => ({
  useEffect: (effect: () => void | (() => void)) => effect()
}))

vi.mock('../stores/window', () => ({
  useWindowStore: { getState: () => ({ setState: vi.fn() }) }
}))

vi.mock('../stores/player', () => ({
  usePlayerStore: {
    getState: () => ({ toggle: vi.fn(), setVolume: vi.fn(), seek: vi.fn(), volume: 0.5 })
  }
}))

vi.mock('../stores/playlist', () => ({
  usePlaylistStore: { getState: () => ({ next: vi.fn(), prev: vi.fn() }) }
}))

vi.mock('../stores/settings', () => ({
  useSettingsStore: {
    getState: () => ({ setMiniPlayerEnabled: harness.setMiniPlayerEnabled })
  }
}))

import { useDesktopBridge } from './useDesktopBridge'

describe('桌面桥接的迷你播放器状态同步', () => {
  beforeEach(() => {
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
})
