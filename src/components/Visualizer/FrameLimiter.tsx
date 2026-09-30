import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'

/**
 * 帧率限制器:配合 Canvas frameloop="never" 使用,按目标 fps 的固定间隔
 * 直接 advance 渲染,避免 invalidate 的第二层 RAF 合并或延迟目标帧。
 * fps<=0 时不做任何事(由外层把 frameloop 切回 always,即不限帧)。
 */
export function FrameLimiter({ fps }: { fps: number }) {
  const advance = useThree((s) => s.advance)
  const clock = useThree((s) => s.clock)

  useEffect(() => {
    if (fps <= 0) return
    const interval = 1000 / fps
    const tolerance = 0.75
    let frame = 0
    let last = performance.now()
    let lastRender = last
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop)
      if (document.hidden) {
        last = lastRender = now
        return
      }
      const elapsed = now - last
      if (elapsed < interval - tolerance) return
      // 提前落在容差内的帧也要推进完整周期，避免下一次 RAF 重复渲染。
      // 丢帧时跳过已过期的周期，保持节奏但不补帧。
      last += Math.floor((elapsed + tolerance) / interval) * interval
      // never 模式的时钟单位是秒；保持切换帧率时连续，避免后台恢复时跳进。
      const delta = Math.min(0.1, Math.max(0, (now - lastRender) / 1000))
      lastRender = now
      advance(clock.elapsedTime + delta)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [fps, advance, clock])

  return null
}
