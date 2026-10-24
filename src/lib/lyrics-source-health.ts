import { useLyricsSourceStore } from '../stores/lyrics-source'
import { LYRIC_PRIORITY_SOURCES, type LyricOrigin, type LyricCandidateStatus, type LyricPrioritySource } from '../types/lyrics-source'

export const LYRICS_SOURCE_FAILURE_LIMIT = 3
export function suspendedLyricsSource(origin: LyricOrigin): boolean {
  return useLyricsSourceStore.getState().health[origin as LyricPrioritySource]?.suspended === true
}

/** 仅宿主内存持有；取消、无收录和错配不能被当成连接故障。已暂停来源只由手动成功测试恢复。 */
export function reportLyricsSource(origin: LyricOrigin, status: LyricCandidateStatus, probe = false): void {
  if (!LYRIC_PRIORITY_SOURCES.includes(origin as LyricPrioritySource)) return
  const source = origin as LyricPrioritySource
  const current = useLyricsSourceStore.getState().health[source]
  if (current?.suspended && !(probe && status === 'ready')) return
  if (status !== 'error' && status !== 'ready' && status !== 'empty' && status !== 'mismatch') return
  const failures = status === 'error' ? (current?.failures ?? 0) + 1 : 0
  useLyricsSourceStore.setState(state => ({ health: { ...state.health, [source]: {
    failures: Math.min(LYRICS_SOURCE_FAILURE_LIMIT, failures), suspended: failures >= LYRICS_SOURCE_FAILURE_LIMIT,
  } } }))
}
