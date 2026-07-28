import { useEffect, useRef } from 'react'
import { useShuangeStore } from '../stores/shuange'
import { usePlayerStore } from '../stores/player'

const FADE_MS = 200

function rampVolume(target: number, ms: number, setVolume: (v: number) => void, from: number): void {
  const start = performance.now()
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / ms)
    setVolume(from + (target - from) * t)
    if (t < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

/** 绑定刷歌播放:到片段末尾自动 next;切歌 200ms 淡入淡出。 */
export function useShuangePlayer(): void {
  const active = useShuangeStore((s) => s.active)
  const offset = useShuangeStore((s) => s.offset)
  const index = useShuangeStore((s) => s.index)
  const next = useShuangeStore((s) => s.next)
  const prevIndexRef = useRef(index)

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

  // 切歌淡入淡出:index 变化时先淡出到 0 再淡回 1(loadTrack 已同步替换源)
  useEffect(() => {
    if (!active || index === prevIndexRef.current) return
    const eng = usePlayerStore.getState()._engine()
    const prevVol = usePlayerStore.getState().volume || 0.8
    rampVolume(0, FADE_MS, (v) => eng.setVolume(v), prevVol)
    const timer = setTimeout(() => rampVolume(prevVol, FADE_MS, (v) => eng.setVolume(v), 0), FADE_MS + 30)
    prevIndexRef.current = index
    return () => clearTimeout(timer)
  }, [active, index])
}