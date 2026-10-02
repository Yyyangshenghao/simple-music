import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  enabled: true, play: vi.fn(), pause: vi.fn(), seek: vi.fn(), next: vi.fn(), prev: vi.fn(),
  onSettings: undefined as ((state: { mediaKeysEnabled: boolean }, previous: { mediaKeysEnabled: boolean }) => void) | undefined,
  onPlayer: undefined as ((state: unknown, prev: unknown) => void) | undefined
}))
vi.mock('../stores/settings', () => ({ useSettingsStore: {
  getState: () => ({ mediaKeysEnabled: h.enabled }), subscribe: (cb: typeof h.onSettings) => { h.onSettings = cb }
} }))
vi.mock('../stores/player', () => ({ usePlayerStore: {
  getState: () => ({ currentTrack: null, duration: 0, play: h.play, pause: h.pause, seek: h.seek }),
  subscribe: (cb: typeof h.onPlayer) => { h.onPlayer = cb }
} }))
vi.mock('../stores/playlist', () => ({ usePlaylistStore: { getState: () => ({ next: h.next, prev: h.prev }) } }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  h.enabled = true
})

describe('系统媒体键开关', () => {
  it('播放/切歌/定位/停止沿用播放器动作，关闭后阻止媒体键和默认 HTML audio 控制', async () => {
    const handlers = new Map<string, MediaSessionActionHandler>()
    const ms = { metadata: null, playbackState: 'none', setActionHandler: vi.fn((action, handler) => handlers.set(action, handler)) }
    vi.stubGlobal('navigator', { mediaSession: ms })
    const { initMediaSession } = await import('./media-session')
    initMediaSession()
    handlers.get('play')?.({ action: 'play' })
    handlers.get('nexttrack')?.({ action: 'nexttrack' })
    handlers.get('seekto')?.({ action: 'seekto', seekTime: 42 })
    handlers.get('stop')?.({ action: 'stop' })
    expect(h.play).toHaveBeenCalledOnce()
    expect(h.next).toHaveBeenCalledOnce()
    expect(h.seek.mock.calls).toEqual([[42], [0]])
    expect(h.pause).toHaveBeenCalledOnce()
    h.enabled = false
    h.onSettings?.({ mediaKeysEnabled: false }, { mediaKeysEnabled: true })
    handlers.get('play')?.({ action: 'play' })
    expect(h.play).toHaveBeenCalledOnce()
    expect(ms.playbackState).toBe('none')
    expect(handlers.get('play')).toBeTypeOf('function')
    h.enabled = true
    h.onSettings?.({ mediaKeysEnabled: true }, { mediaKeysEnabled: false })
    handlers.get('play')?.({ action: 'play' })
    expect(h.play).toHaveBeenCalledTimes(2)
    vi.unstubAllGlobals()
  })
})
