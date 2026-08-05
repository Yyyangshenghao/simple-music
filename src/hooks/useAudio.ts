import { useEffect } from 'react'
import { usePlayerStore } from '../stores/player'
import { useLyricsStore } from '../stores/lyrics'

// 把播放进度驱动到歌词滚动；卸载时不销毁引擎（单例随应用存活）。
export function useAudio(): void {
  useEffect(() => {
    useLyricsStore.getState().tick(usePlayerStore.getState().position)
    return usePlayerStore.subscribe((state, previous) => {
      if (state.position !== previous.position) useLyricsStore.getState().tick(state.position)
    })
  }, [])
}
