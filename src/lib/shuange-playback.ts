import { initShuangeSession, useShuangeStore } from '../stores/shuange'
import { registerTrackEndedInterceptor, usePlayerStore } from '../stores/player'
import { useNavigationStore } from '../stores/navigation'
import { shouldAdvanceShuangeClip, shouldReleaseShuangeAdvanceLock } from './shuange-playback-policy'

let stopShuangePlayback: (() => void) | undefined

/** 导航决定会话进入/离开，界面卸载不结束刷歌；片段与自然结束走同一推进入口。 */
export function initShuangePlayback(): () => void {
  if (stopShuangePlayback) return stopShuangePlayback
  const stopSession = initShuangeSession()
  let stopped = false
  let revision = 0
  let advancing = false
  const advance = (ended = false) => {
    if (stopped) return false
    const state = useShuangeStore.getState()
    const track = state.feed[state.index]
    const player = usePlayerStore.getState()
    const current = player.currentTrack
    if (!state.active) return false
    // 仅已接管的片段在换曲加载中吞掉旧 ended；首屏等推荐仍保留原队列行为。
    if (state.loading) return ended && String(player.contextId).startsWith('shuange:') && !!current
      && state.feed.some(item => item.source === current.source && String(item.id) === String(current.id))
    if (!state.offset || state.offset.endSec <= state.offset.startSec
      || !track || !current || track.source !== current.source || String(track.id) !== String(current.id)) return false
    if (advancing) return true
    advancing = true
    const request = revision
    const beforeIndex = state.index
    const release = () => {
      const latest = useShuangeStore.getState()
      if (!stopped && revision === request && shouldReleaseShuangeAdvanceLock(beforeIndex, latest.index, latest.active)) advancing = false
    }
    void state.next().then(release, release)
    return true
  }
  const stopState = useShuangeStore.subscribe((state, previous) => {
    if (state.active !== previous.active || state.index !== previous.index || state.offset !== previous.offset) {
      ++revision
      advancing = false
    }
  })
  const stopPlayer = usePlayerStore.subscribe((player) => {
    if (shouldAdvanceShuangeClip(player.position, player.status, useShuangeStore.getState().offset)) advance()
  })
  const stopEnded = registerTrackEndedInterceptor(() => advance(true))
  const syncNavigation = () => {
    if (stopped) return
    const state = useShuangeStore.getState()
    if (useNavigationStore.getState().currentView === 'shuange') {
      if (!state.active) void state.enter()
    } else if (state.active) state.leave()
  }
  const stopNavigation = useNavigationStore.subscribe((state, previous) => {
    if ((state.currentView === 'shuange') !== (previous.currentView === 'shuange')) syncNavigation()
  })
  syncNavigation()
  stopShuangePlayback = () => {
    if (stopped) return
    stopped = true
    stopState()
    stopPlayer()
    stopEnded()
    stopNavigation()
    stopSession()
    stopShuangePlayback = undefined
  }
  return stopShuangePlayback
}
