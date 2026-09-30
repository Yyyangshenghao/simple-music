import { useEffect } from 'react'
import { lyricPlaybackPosition } from '../lib/lyric-playback-position'
import { usePlayerStore } from '../stores/player'
import { useLyricsStore } from '../stores/lyrics'

// 把播放进度驱动到歌词滚动；卸载时不销毁引擎（单例随应用存活）。
export function useAudio(): void {
  useEffect(() => {
    useLyricsStore.getState().tick(usePlayerStore.getState().position)
    const unsubscribe = usePlayerStore.subscribe((state, previous) => {
      if (state.playbackTransport !== 'musickit' && state.position !== previous.position) useLyricsStore.getState().tick(state.position)
    })
    // 行切换与逐字高亮共用连续时钟，避免每秒换行与逐帧扫光不同步。
    const timer = setInterval(() => {
      const state = usePlayerStore.getState()
      if (state.playbackTransport === 'musickit') useLyricsStore.getState().tick(lyricPlaybackPosition(state))
    }, 50)
    return () => { unsubscribe(); clearInterval(timer) }
  }, [])
}
