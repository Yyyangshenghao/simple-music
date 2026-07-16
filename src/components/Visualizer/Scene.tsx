import { Canvas } from '@react-three/fiber'
import { useVisualStore } from '../../stores/visual'
import { ParticleCloud } from './ParticleCloud'
import { CinemaCamera } from './CinemaCamera'
import { FrameLimiter } from './FrameLimiter'

// 动态壁纸是桌面最底层的氛围背景,30fps 足够;不钳会跟着显示器刷新率满帧跑
const WALLPAPER_FPS = 30

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
      <Canvas
        camera={{ position: [0, 0, 14], fov: 60 }}
        dpr={[1, 1.5]}
        frameloop="demand"
        gl={{ antialias: false, alpha: true }}
      >
        <FrameLimiter fps={WALLPAPER_FPS} />
        <CinemaCamera />
        <ParticleCloud />
      </Canvas>
    </div>
  )
}
