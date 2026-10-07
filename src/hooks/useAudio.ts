import { useEffect } from 'react'
import { lyricPlaybackPosition } from '../lib/lyric-playback-position'
import { usePlayerStore } from '../stores/player'
import { useLyricsStore } from '../stores/lyrics'

// 把播放进度驱动到歌词滚动；卸载时不销毁引擎（单例随应用存活）。
export function useAudio(enabled = true, lowPower = false): void {
  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setInterval> | undefined
    const tick = () => {
      const state = usePlayerStore.getState()
      useLyricsStore.getState().tick(state.playbackTransport === 'musickit'
        ? lyricPlaybackPosition(state)
        : state.position)
    }
    const syncTimer = () => {
      const state = usePlayerStore.getState()
      const continuous = state.playbackTransport === 'musickit' && state.status === 'playing'
      // 行切换与逐字高亮共用连续时钟；暂停和普通音频由状态变化驱动。
      if (continuous && timer === undefined) timer = setInterval(tick, lowPower ? 250 : 50)
      else if (!continuous && timer !== undefined) {
        clearInterval(timer)
        timer = undefined
      }
    }
    tick()
    syncTimer()
    const unsubscribe = usePlayerStore.subscribe((state, previous) => {
      if (state.position !== previous.position || state.status !== previous.status
        || state.playbackTransport !== previous.playbackTransport || state.currentTrack !== previous.currentTrack) tick()
      if (state.status !== previous.status || state.playbackTransport !== previous.playbackTransport) syncTimer()
    })
    const unsubscribeOffset = useLyricsStore.subscribe((state, previous) => {
      if (state.offsetSec !== previous.offsetSec) tick()
    })
    return () => {
      unsubscribe()
      unsubscribeOffset()
      if (timer !== undefined) clearInterval(timer)
    }
  }, [enabled, lowPower])
}
