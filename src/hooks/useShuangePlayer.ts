import { useEffect } from 'react'
import { useShuangeStore } from '../stores/shuange'
import { registerTrackEndedInterceptor, usePlayerStore } from '../stores/player'

/** 绑定刷歌播放:到片段末尾回到精彩段起点。切歌淡入由 AudioEngine 内置 rampGain 自动完成。 */
export function useShuangePlayer(): void {
  const active = useShuangeStore((s) => s.active)
  const offset = useShuangeStore((s) => s.offset)

  useEffect(() => {
    if (!active) return
    const loop = () => {
      const start = offset?.startSec
      const end = offset?.endSec
      if (start == null || end == null || end <= start) return false
      const player = usePlayerStore.getState()
      player.seek(start)
      player.play()
      return true
    }
    const unsub = usePlayerStore.subscribe((s) => {
      const start = offset?.startSec
      const end = offset?.endSec
      if (start != null && end != null && end > start && s.position >= end - 0.3 && s.status === 'playing') {
        loop()
      }
    })
    const unregisterEnded = registerTrackEndedInterceptor(loop)
    return () => {
      unsub()
      unregisterEnded()
    }
  }, [active, offset])
}
