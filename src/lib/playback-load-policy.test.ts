import { describe, expect, it } from 'vitest'
import {
  canUseOriginPlaybackShortcut,
  playbackStatusForEngineEvent,
  shouldAutoplayPlaybackReload,
} from './playback-load-policy'

describe('playback reload policy', () => {
  it('暂停态重建只预载，不自动恢复播放', () => {
    expect(shouldAutoplayPlaybackReload('paused')).toBe(false)
    expect(playbackStatusForEngineEvent('loading', false)).toBe('paused')
    expect(shouldAutoplayPlaybackReload('playing')).toBe(true)
    expect(shouldAutoplayPlaybackReload('loading')).toBe(true)
  })

  it('手动优先另一平台时禁用原源直链和预解析捷径', () => {
    expect(canUseOriginPlaybackShortcut('netease', 'qq')).toBe(false)
    expect(canUseOriginPlaybackShortcut('netease', 'netease')).toBe(true)
    expect(canUseOriginPlaybackShortcut('netease')).toBe(true)
  })
})
