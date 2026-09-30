import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MINI_PLAYER_APPEARANCE, MINI_PLAYER_LYRICS_WIDTH } from '../lib/mini-player-config'

interface TestLyrics { currentIndex: number; lines: Array<{ text: string }> }
interface TestPlayer { currentTrack: null | { source: string }; status: string; volume: number; duration: number; position: number }

const harness = vi.hoisted(() => ({
  settings: { miniPlayerEnabled: true, miniPlayerWidth: 360, miniPlayerAppearance: { showLyrics: true, showProgress: true } },
  player: { currentTrack: null as null | { source: string }, status: 'playing', volume: 1, duration: 240, position: 10 },
  playerListeners: new Set<(state: TestPlayer, previous: TestPlayer) => void>(),
  lyrics: { currentIndex: 0, lines: [{ text: '第一句' }, { text: '第二句' }] },
  lyricSelector: undefined as ((state: TestLyrics) => string) | undefined,
  cleanups: [] as Array<() => void>,
  update: vi.fn()
}))

vi.mock('react', () => ({
  useEffect: (effect: () => void | (() => void)) => {
    const cleanup = effect()
    if (cleanup) harness.cleanups.push(cleanup)
  }
}))
vi.mock('../stores/settings', () => ({ useSettingsStore: (selector: (state: typeof harness.settings) => unknown) => selector(harness.settings) }))
vi.mock('../stores/player', () => ({ usePlayerStore: Object.assign(
  (selector: (state: typeof harness.player) => unknown) => selector(harness.player),
  { getState: () => harness.player, subscribe: (listener: (state: typeof harness.player, previous: typeof harness.player) => void) => {
    harness.playerListeners.add(listener)
    return () => harness.playerListeners.delete(listener)
  } }
) }))
vi.mock('../stores/ambient', () => ({ useAmbientStore: (selector: (state: { palette: string[] }) => unknown) => selector({ palette: ['#5227ff'] }) }))
vi.mock('../stores/lyrics', () => ({ useLyricsStore: (selector: (state: typeof harness.lyrics) => string) => {
  harness.lyricSelector = selector
  return selector(harness.lyrics)
} }))

import { useMiniPlayerSync } from './useMiniPlayerSync'

describe('迷你条只同步实际展示的数据', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    harness.settings.miniPlayerEnabled = true
    harness.settings.miniPlayerWidth = 360
    harness.settings.miniPlayerAppearance = { ...DEFAULT_MINI_PLAYER_APPEARANCE }
    harness.player.status = 'playing'
    harness.player.currentTrack = null
    harness.player.position = 10
    harness.update.mockReset()
    vi.stubGlobal('window', { desktop: { updateMiniPlayer: harness.update } })
  })
  afterEach(() => {
    harness.cleanups.splice(0).forEach((cleanup) => cleanup())
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('紧凑条不订阅隐藏歌词的换行', () => {
    useMiniPlayerSync()

    expect(harness.lyricSelector?.(harness.lyrics)).toBe('')
    expect(harness.lyricSelector?.({ ...harness.lyrics, currentIndex: 1 })).toBe('')
    expect(harness.update).toHaveBeenCalledWith({ lyricLine: '' })
  })

  it('展开后同步当前歌词', () => {
    harness.settings.miniPlayerWidth = MINI_PLAYER_LYRICS_WIDTH
    useMiniPlayerSync()

    expect(harness.update).toHaveBeenCalledWith({ lyricLine: '第一句' })
    expect(harness.lyricSelector?.({ ...harness.lyrics, currentIndex: 1 })).toBe('第二句')
  })

  it('关闭进度展示后不启动周期进度推送', () => {
    harness.settings.miniPlayerAppearance.showProgress = false
    useMiniPlayerSync()
    harness.update.mockClear()
    vi.advanceTimersByTime(5000)

    expect(harness.update).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('播放时以 1Hz 推送进度，卸载后停止', () => {
    useMiniPlayerSync()
    harness.update.mockClear()
    harness.player.position = 11
    vi.advanceTimersByTime(1000)
    expect(harness.update).toHaveBeenCalledOnce()
    expect(harness.update).toHaveBeenCalledWith({ position: 11 })

    harness.cleanups.splice(0).forEach((cleanup) => cleanup())
    harness.update.mockClear()
    vi.advanceTimersByTime(5000)
    expect(harness.update).not.toHaveBeenCalled()
  })

  it.each(['apple', 'netease', 'qq'])('%s 加载时的按钮反馈与控制意图一致', (source) => {
    harness.player.currentTrack = { source }
    harness.player.status = 'loading'
    useMiniPlayerSync()
    expect(harness.update).toHaveBeenCalledWith(expect.objectContaining({ playing: source === 'apple' }))
  })

  it('暂停时拖动立即同步，播放中的位置变化仍按周期推送', () => {
    harness.player.status = 'paused'
    useMiniPlayerSync()
    harness.update.mockClear()
    const previous = { ...harness.player }
    harness.player.position = 42
    harness.playerListeners.forEach((listener) => listener(harness.player, previous))
    expect(harness.update).toHaveBeenCalledOnce()
    expect(harness.update).toHaveBeenCalledWith({ position: 42 })

    harness.update.mockClear()
    harness.player.status = 'playing'
    harness.player.position = 43
    harness.playerListeners.forEach((listener) => listener(harness.player, previous))
    expect(harness.update).not.toHaveBeenCalled()
  })
})
