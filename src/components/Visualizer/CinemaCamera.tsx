import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useVisualStore } from '../../stores/visual'

// 影院相机：缓慢环绕 + 可选轻微抖动（cinema/cinemaShake）。
export function CinemaCamera() {
  const { camera } = useThree()
  const t = useRef(0)

  useFrame((_, delta) => {
    const fx = useVisualStore.getState().fx
    t.current += delta
    const cinema = fx.cinema !== false
    const radius = 14
    if (cinema) {
      const angle = t.current * 0.06
      camera.position.x = Math.sin(angle) * radius
      camera.position.z = Math.cos(angle) * radius
      const shake = (Number(fx.cinemaShake) || 0) * 0.3
      camera.position.y = Math.sin(t.current * 1.7) * shake
    } else {
      camera.position.set(0, 0, radius)
    }
    camera.lookAt(0, 0, 0)
  })

  return null
}
