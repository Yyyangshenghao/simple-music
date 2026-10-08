// 异步点播开始时登记意图；后续选曲或播放控制使较早的请求失效。
let currentIntent = 0

export function beginPlaybackIntent(): number {
  return ++currentIntent
}

export function isCurrentPlaybackIntent(intent: number): boolean {
  return intent === currentIntent
}
