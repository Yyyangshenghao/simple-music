import { describe, expect, it } from 'vitest'
import {
  canUseOriginPlaybackShortcut,
  mediaFailureReasonFromPlayError,
  playbackStatusForEngineEvent,
  shouldRecoverAfterOutputDeviceChange,
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

  it('只把明确不支持的媒体拒绝交给候选降级', () => {
    const unsupported = new Error('source is not supported')
    unsupported.name = 'NotSupportedError'
    const blocked = new Error('user gesture required')
    blocked.name = 'NotAllowedError'
    const aborted = new Error('new load started')
    aborted.name = 'AbortError'

    expect(mediaFailureReasonFromPlayError(unsupported)).toBe('MEDIA_PLAY_NOT_SUPPORTED')
    expect(mediaFailureReasonFromPlayError(blocked)).toBeUndefined()
    expect(mediaFailureReasonFromPlayError(aborted)).toBeUndefined()
  })

  it('设备切换只恢复播放中的会话', () => {
    expect(shouldRecoverAfterOutputDeviceChange('playing', false)).toBe(true)
    expect(shouldRecoverAfterOutputDeviceChange('loading', false)).toBe(true)
    expect(shouldRecoverAfterOutputDeviceChange('paused', true)).toBe(true)
    expect(shouldRecoverAfterOutputDeviceChange('paused', false)).toBe(false)
  })
})
