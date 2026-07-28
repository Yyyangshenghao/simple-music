import { useEffect } from 'react'
import { useShuangeStore } from '../stores/shuange'
import { usePlayerStore } from '../stores/player'

/** 绑定刷歌播放:到片段末尾自动 next。切歌淡入由 AudioEngine 内置 rampGain 自动完成。 */
export function useShuangePlayer(): void {
  const active = useShuangeStore((s) => s.active)
  const offset = useShuangeStore((s) => s.offset)
  const next = useShuangeStore((s) => s.next)

  useEffect(() => {
    if (!active) return
    const unsub = usePlayerStore.subscribe((s) => {
      const end = offset?.endSec
      if (end != null && s.position >= end && s.status !== 'paused') {
        void next()
      }
    })
    return unsub
  }, [active, offset, next])
}