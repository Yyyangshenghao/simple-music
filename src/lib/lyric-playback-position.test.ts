import { describe, expect, it, vi } from 'vitest'
import { lyricPlaybackPosition } from './lyric-playback-position'
import type { Track } from '../types/domain'

function playback(source: Track['source'], transport: 'online' | 'musickit' | null) {
  return {
    currentTrack: { source } as Track,
    playbackTransport: transport,
    position: 32,
    _engine: vi.fn(() => ({ position: 12.345 }))
  }
}

describe('歌词播放时钟', () => {
  it('Apple 逐字动画读取连续时钟而不是离散快照', () => {
    const player = { ...playback('apple', 'musickit'), _lyricPosition: () => 32.625 }
    expect(lyricPlaybackPosition(player)).toBe(32.625)
  })
  it('Apple Music 使用播放器同步位置，不读取旧音频引擎', () => {
    const player = playback('apple', 'musickit')
    expect(lyricPlaybackPosition(player)).toBe(32)
    expect(player._engine).not.toHaveBeenCalled()
  })

  it('Apple Music 拖动后立即采用新位置，暂停时保持不变', () => {
    const player = playback('apple', 'musickit')
    expect(lyricPlaybackPosition(player)).toBe(32)
    player.position = 80
    expect(lyricPlaybackPosition(player)).toBe(80)
    expect(lyricPlaybackPosition(player)).toBe(80)
    player.position = 0
    expect(lyricPlaybackPosition(player)).toBe(0)
  })

  it('Apple Music 加载时采用待播放位置', () => {
    expect(lyricPlaybackPosition(playback('apple', null))).toBe(32)
  })

  it('跨源播放按实际 MusicKit 传输选择时钟', () => {
    expect(lyricPlaybackPosition(playback('netease', 'musickit'))).toBe(32)
  })

  it.each(['netease', 'qq'] as const)('%s 保留音频引擎的精确时钟', source => {
    expect(lyricPlaybackPosition(playback(source, 'online'))).toBe(12.345)
  })

  it('Apple 曲目使用其他普通音源时采用引擎时钟', () => {
    expect(lyricPlaybackPosition(playback('apple', 'online'))).toBe(12.345)
  })
})
