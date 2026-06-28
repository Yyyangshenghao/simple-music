import { useEffect } from 'react'
import { usePlayerStore } from '../stores/player'
import { useLyricsStore } from '../stores/lyrics'

// 把播放进度驱动到歌词滚动；卸载时不销毁引擎（单例随应用存活）。
export function useAudio(): void {
  const position = usePlayerStore((s) => s.position)

  useEffect(() => {
    useLyricsStore.getState().tick(position)
  }, [position])
}
