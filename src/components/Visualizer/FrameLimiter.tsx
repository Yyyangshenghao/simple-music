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
    const id = window.setInterval(() => invalidate(), 1000 / fps)
    return () => window.clearInterval(id)
  }, [fps, invalidate])

  return null
}
