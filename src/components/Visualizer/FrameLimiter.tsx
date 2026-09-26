import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'

/**
 * 帧率限制器:配合 Canvas frameloop="demand" 使用,按目标 fps 的固定间隔
 * 手动 invalidate 触发渲染,把整个 3D 场景(渲染 + useFrame 逻辑)钳到目标帧率。
 * fps<=0 时不做任何事(由外层把 frameloop 切回 always,即不限帧)。
 */
export function FrameLimiter({ fps }: { fps: number }) {
  const invalidate = useThree((s) => s.invalidate)

  useEffect(() => {
    if (fps <= 0) return
    const interval = 1000 / fps
    let frame = 0
    let last = performance.now()
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop)
      if (document.hidden || now - last < interval - 0.75) return
      // 丢帧时从当前时刻重新对齐，避免 setInterval 式补帧造成连续抖动。
      last = now - ((now - last) % interval)
      invalidate()
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [fps, invalidate])

  return null
}
