import { useEffect, useState } from 'react'
import { useSpring, useMotionValueEvent } from 'motion/react'
import { useAmbientStore } from '../../stores/ambient'
import { useVisualStore } from '../../stores/visual'
import { usePlayerStore } from '../../stores/player'
import { gentleSpringValues } from '../../lib/motion-presets'
import LiquidEther from '../Visualizer/LiquidEther'
import styles from './AppShell.module.css'

interface AmbientBackgroundProps {
  /** 为 true 时隐藏背景层（如歌词页 3D 模式打开，保证同屏只有一个全屏 WebGL）。 */
  hidden?: boolean
}

/** 全局氛围背景层：封面调色板驱动的流体/CSS 霞光。播放缓动的高频 state 隔离在本组件内。 */
export function AmbientBackground({ hidden }: AmbientBackgroundProps) {
  const palette = useAmbientStore((s) => s.palette)
  const performanceMode = useVisualStore((s) => s.performanceMode)
  const playing = usePlayerStore((s) => s.status === 'playing')

  // 播放/暂停背景强度缓动：单弹簧 0↔1，避免流体参数跳变
  const playSpring = useSpring(playing ? 1 : 0, gentleSpringValues)
  const [playAmount, setPlayAmount] = useState(playing ? 1 : 0)
  useEffect(() => {
    playSpring.set(playing ? 1 : 0)
  }, [playing, playSpring])
  useMotionValueEvent(playSpring, 'change', (v) => setPlayAmount(v))

  return (
    // display:none 时 LiquidEther 内置 IntersectionObserver 自动暂停渲染
    <div className={styles.background} style={hidden ? { display: 'none' } : undefined}>
      {performanceMode === 'eco' ? (
        <div className={styles.auroraFallback} aria-hidden="true" />
      ) : (
        <LiquidEther
          colors={palette}
          mouseForce={12}
          cursorSize={80}
          resolution={performanceMode === 'balanced' ? 0.4 : 0.5}
          autoDemo={true}
          autoSpeed={0.25 + 0.2 * playAmount}
          autoIntensity={1.2 + 0.6 * playAmount}
          autoResumeDelay={2000}
        />
      )}
    </div>
  )
}
