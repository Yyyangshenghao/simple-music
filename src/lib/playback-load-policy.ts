import type { PlaybackStatus } from './audio-engine'
import type { ProviderId } from '../providers/types'
import type { MusicSource } from '../types/domain'

/** 只有正在播放或已经处于起播流程的会话，重建后才应继续自动播放。 */
export function shouldAutoplayPlaybackReload(status: PlaybackStatus): boolean {
  return status === 'playing' || status === 'loading'
}

/** 手动软优先另一个平台时，不能被原平台的直链或预解析缓存短路。 */
export function canUseOriginPlaybackShortcut(
  originSource: MusicSource,
  preferredSource?: ProviderId
): boolean {
  return !preferredSource || preferredSource === originSource
}

/** 预载但不自动播放时，AudioEngine 的 loading/waiting 事件不得破坏暂停态。 */
export function playbackStatusForEngineEvent(
  status: PlaybackStatus,
  autoplay: boolean
): PlaybackStatus {
  return !autoplay && status === 'loading' ? 'paused' : status
}

/**
 * play() 的权限拒绝和新请求打断不代表地址坏了；浏览器明确报告格式/来源不支持时，
 * 才把失败交回候选解析器继续降质或换源。
 */
export function mediaFailureReasonFromPlayError(error: unknown): string | undefined {
  const name = error instanceof Error
    ? error.name
    : typeof error === 'object' && error && 'name' in error
      ? String(error.name)
      : ''
  return name === 'NotSupportedError' ? 'MEDIA_PLAY_NOT_SUPPORTED' : undefined
}
