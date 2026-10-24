import { useLyricsSourceStore } from '../stores/lyrics-source'
import { LYRIC_PRIORITY_SOURCES, type LyricOrigin, type LyricCandidateStatus, type LyricPrioritySource } from '../types/lyrics-source'

export const LYRICS_SOURCE_FAILURE_LIMIT = 3
/** 首次暂停 30 秒，冷却后放行试探；试探仍失败则冷却翻倍，最长 10 分钟。 */
export const LYRICS_SOURCE_COOLDOWN_MS = 30_000
export const LYRICS_SOURCE_MAX_COOLDOWN_MS = 10 * 60_000

/** 只在冷却期内跳过；冷却结束即放行，由下一次结果决定恢复或延长冷却。 */
export function suspendedLyricsSource(origin: LyricOrigin, now = Date.now()): boolean {
  const health = useLyricsSourceStore.getState().health[origin as LyricPrioritySource]
  return health?.suspended === true && now < (health.retryAt ?? Infinity)
}

/** 仅宿主内存持有；取消、无收录和错配不能被当成连接故障。冷却期内的结果不改变状态，手动测试成功随时恢复。 */
export function reportLyricsSource(origin: LyricOrigin, status: LyricCandidateStatus, probe = false, now = Date.now()): void {
  if (!LYRIC_PRIORITY_SOURCES.includes(origin as LyricPrioritySource)) return
  const source = origin as LyricPrioritySource
  const current = useLyricsSourceStore.getState().health[source]
  if (status !== 'error' && status !== 'ready' && status !== 'empty' && status !== 'mismatch') return
  if (current?.suspended) {
    // 手动测试只有取到歌词才算恢复；测试失败或未收录不改变自动试探的冷却时间。
    if (probe ? status !== 'ready' : suspendedLyricsSource(source, now)) return
  }
  const failures = status === 'error' ? (current?.failures ?? 0) + 1 : 0
  const suspended = failures >= LYRICS_SOURCE_FAILURE_LIMIT
  const cooldownMs = !suspended ? undefined : current?.suspended && current.cooldownMs
    ? Math.min(LYRICS_SOURCE_MAX_COOLDOWN_MS, current.cooldownMs * 2) : LYRICS_SOURCE_COOLDOWN_MS
  useLyricsSourceStore.setState(state => ({ health: { ...state.health, [source]: {
    failures: Math.min(LYRICS_SOURCE_FAILURE_LIMIT, failures), suspended,
    ...(cooldownMs ? { cooldownMs, retryAt: now + cooldownMs } : {}),
  } } }))
}
