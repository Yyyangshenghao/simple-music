import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useVisualStore } from '../../stores/visual'
import { useSettingsStore } from '../../stores/settings'

// 影院相机：缓慢环绕 + 可选轻微抖动（cinema/cinemaShake）。
// 封面粒子云（cover-cloud）改由自己控制固定机位 + 摇晃，这里让位，不与其抢相机。
export function CinemaCamera() {
  const { camera } = useThree()
  const t = useRef(0)

  useFrame((_, delta) => {
    if (useSettingsStore.getState().lyrics3dEffect === 'cover-cloud') return

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
