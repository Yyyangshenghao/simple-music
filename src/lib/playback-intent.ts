// 异步点播开始时登记意图；后续选曲或播放控制使较早的请求失效。
let currentIntent = 0
let pauseIntent = false

export function beginPlaybackIntent(kind?: 'pause'): number {
  pauseIntent = kind === 'pause'
  return ++currentIntent
}

export function isCurrentPlaybackIntent(intent: number): boolean {
  return intent === currentIntent
}

/** 自动推进只观察当前意图，不抢占等待中的用户操作。 */
export function currentPlaybackIntent(): number {
  return currentIntent
}

/** 暂停是保持已选曲静音载入的唯一后续意图，不依赖迟到的媒体状态。 */
export function isPlaybackPauseIntent(): boolean {
  return pauseIntent
}
