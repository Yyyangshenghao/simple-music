import { Canvas } from '@react-three/fiber'
import { useVisualStore } from '../../stores/visual'
import { ParticleCloud } from './ParticleCloud'
import { CinemaCamera } from './CinemaCamera'

interface SceneProps {
  className?: string
}

/** 可视化场景：全屏背景层，承载粒子云与影院相机。 */
export function Scene({ className }: SceneProps) {
  const backgroundColor = useVisualStore((s) => s.fx.backgroundColor)
  const backgroundOpacity = useVisualStore((s) => s.fx.backgroundOpacity)

  return (
    <div
      className={className}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 0,
        background: backgroundColor || '#04060c',
        opacity: typeof backgroundOpacity === 'number' ? backgroundOpacity : 1
      }}
    >
      <Canvas camera={{ position: [0, 0, 14], fov: 60 }} dpr={[1, 1.5]} gl={{ antialias: false, alpha: true }}>
        <CinemaCamera />
        <ParticleCloud />
      </Canvas>
    </div>
  )
}
