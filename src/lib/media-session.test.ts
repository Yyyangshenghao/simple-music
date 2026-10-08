import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../types/domain'

const h = vi.hoisted(() => ({
  enabled: true, play: vi.fn(), pause: vi.fn(), seek: vi.fn(), next: vi.fn(), prev: vi.fn(),
  shuangeActive: false, feedNext: vi.fn(), feedPrev: vi.fn(),
  player: { currentTrack: null as Track | null, duration: 0, position: 0, status: 'idle', rate: 1 },
  onSettings: undefined as ((state: { mediaKeysEnabled: boolean }, previous: { mediaKeysEnabled: boolean }) => void) | undefined,
  onPlayer: undefined as ((state: unknown, prev: unknown) => void) | undefined
}))
vi.mock('../stores/settings', () => ({ useSettingsStore: {
  getState: () => ({ mediaKeysEnabled: h.enabled }), subscribe: (cb: typeof h.onSettings) => { h.onSettings = cb }
} }))
vi.mock('../stores/player', () => ({ usePlayerStore: {
  getState: () => ({ ...h.player, play: h.play, pause: h.pause, seek: h.seek }),
  subscribe: (cb: typeof h.onPlayer) => { h.onPlayer = cb }
} }))
vi.mock('../stores/playlist', () => ({ usePlaylistStore: { getState: () => ({ next: h.next, prev: h.prev }) } }))
vi.mock('../stores/shuange', () => ({ useShuangeStore: { getState: () => ({ active: h.shuangeActive, next: h.feedNext, prev: h.feedPrev }) } }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  h.enabled = true
  h.shuangeActive = false
  h.player = { currentTrack: null, duration: 0, position: 0, status: 'idle', rate: 1 }
})
afterEach(() => vi.unstubAllGlobals())

describe('系统媒体键开关', () => {
  it('媒体键在刷歌会话中切换 feed，退出后恢复普通队列控制', async () => {
    const handlers = new Map<string, MediaSessionActionHandler>()
    vi.stubGlobal('navigator', { mediaSession: { setPositionState: vi.fn(), setActionHandler: (action: string, handler: MediaSessionActionHandler) => handlers.set(action, handler) } })
    const { initMediaSession } = await import('./media-session')
    initMediaSession()
    h.shuangeActive = true
    handlers.get('nexttrack')?.({ action: 'nexttrack' })
    handlers.get('previoustrack')?.({ action: 'previoustrack' })
    expect(h.feedNext).toHaveBeenCalledOnce()
    expect(h.feedPrev).toHaveBeenCalledOnce()
    expect(h.next).not.toHaveBeenCalled()
    expect(h.prev).not.toHaveBeenCalled()
    h.shuangeActive = false
    handlers.get('nexttrack')?.({ action: 'nexttrack' })
    expect(h.next).toHaveBeenCalledOnce()
  })
  it('播放/切歌/定位/停止沿用播放器动作，关闭后阻止媒体键和默认 HTML audio 控制', async () => {
    const handlers = new Map<string, MediaSessionActionHandler>()
    const ms = { metadata: null, playbackState: 'none', setPositionState: vi.fn(), setActionHandler: vi.fn((action, handler) => handlers.set(action, handler)) }
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

  it('播放后清空队列时清除系统曲目信息、播放状态与旧进度', async () => {
    const track = { provider: 'netease', source: 'netease', type: 'track', id: 1, name: '晴天', artist: '周杰伦', artists: [] } as Track
    h.player = { currentTrack: track, duration: 180, position: 30, status: 'playing', rate: 1 }
    const ms = { metadata: null, playbackState: 'none', setPositionState: vi.fn(), setActionHandler: vi.fn() }
    vi.stubGlobal('navigator', { mediaSession: ms })
    vi.stubGlobal('MediaMetadata', class { constructor(public data: unknown) {} })
    const { initMediaSession } = await import('./media-session')
    initMediaSession()
    expect(ms.playbackState).toBe('playing')
    expect(ms.setPositionState).toHaveBeenLastCalledWith({ duration: 180, position: 30, playbackRate: 1 })

    const previous = h.player
    h.player = { ...h.player, currentTrack: null, duration: 0, position: 0, status: 'idle' }
    h.onPlayer?.(h.player, previous)

    expect(ms.metadata).toBeNull()
    expect(ms.playbackState).toBe('none')
    expect(ms.setPositionState).toHaveBeenLastCalledWith()
  })

  it('新曲目时长尚未到达时也同步播放状态并清除旧进度', async () => {
    h.player = { currentTrack: { id: 1, name: '歌曲', artist: '歌手' } as Track, duration: 180, position: 30, status: 'playing', rate: 1 }
    const ms = { metadata: null, playbackState: 'none', setPositionState: vi.fn(), setActionHandler: vi.fn() }
    vi.stubGlobal('navigator', { mediaSession: ms })
    vi.stubGlobal('MediaMetadata', class { constructor(public data: unknown) {} })
    const { initMediaSession } = await import('./media-session')
    initMediaSession()
    const previous = h.player
    h.player = { ...h.player, duration: 0, position: 0, status: 'paused' }
    h.onPlayer?.(h.player, previous)
    expect(ms.playbackState).toBe('paused')
    expect(ms.setPositionState).toHaveBeenLastCalledWith()
  })
})
