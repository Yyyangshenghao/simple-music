import { useEffect } from 'react'
import { useShuangeStore } from '../stores/shuange'
import { registerTrackEndedInterceptor, usePlayerStore } from '../stores/player'
import {
  shouldAdvanceShuangeClip,
  shouldReleaseShuangeAdvanceLock,
} from '../lib/shuange-playback-policy'

/** 绑定刷歌播放:到片段末尾自动进入下一首。切歌淡入由 AudioEngine 内置 rampGain 完成。 */
export function useShuangePlayer(): void {
  const active = useShuangeStore((s) => s.active)
  const offset = useShuangeStore((s) => s.offset)

  useEffect(() => {
    if (!active) return
    let advancing = false
    const advance = () => {
      if (!offset || offset.endSec <= offset.startSec) return false
      if (advancing) return true
      advancing = true
      const beforeIndex = useShuangeStore.getState().index
      void useShuangeStore.getState().next().finally(() => {
        const latest = useShuangeStore.getState()
        if (shouldReleaseShuangeAdvanceLock(beforeIndex, latest.index, latest.active)) {
          advancing = false
        }
      })
      return true
    }
    const unsub = usePlayerStore.subscribe((s) => {
      if (shouldAdvanceShuangeClip(s.position, s.status, offset)) advance()
    })
    const unregisterEnded = registerTrackEndedInterceptor(advance)
    return () => {
      unsub()
      unregisterEnded()
    }
  }, [active, offset])
}
