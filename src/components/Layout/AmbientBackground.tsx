import { useEffect, useState } from 'react'
import { useSpring, useMotionValueEvent } from 'motion/react'
import { useAmbientStore } from '../../stores/ambient'
import { useVisualStore } from '../../stores/visual'
import { useSettingsStore } from '../../stores/settings'
import { usePlayerStore } from '../../stores/player'
import { gentleSpringValues } from '../../lib/motion-presets'
import LiquidEther from '../Visualizer/LiquidEther'
import styles from './AmbientBackground.module.css'

interface AmbientBackgroundProps {
  /** 为 true 时隐藏背景层（如歌词页 3D 模式打开，保证同屏只有一个全屏 WebGL）。 */
  hidden?: boolean
}

/** 全局氛围背景层：封面调色板驱动的流体/CSS 霞光。播放缓动的高频 state 隔离在本组件内。 */
export function AmbientBackground({ hidden }: AmbientBackgroundProps) {
  const palette = useAmbientStore((s) => s.palette)
  const performanceMode = useVisualStore((s) => s.performanceMode)
  const bgFluidMotion = useSettingsStore((s) => s.performance.bgFluidMotion)
  const reduceTransparency = useSettingsStore((s) => s.performance.reduceTransparency)
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
      {!bgFluidMotion || reduceTransparency || performanceMode === 'eco' ? (
        <div className={styles.auroraFallback} aria-hidden="true" />
      ) : (
        <LiquidEther
          colors={palette}
          mouseForce={12}
          cursorSize={80}
          resolution={performanceMode === 'balanced' ? 0.4 : 0.5}
          // 氛围背景是缓慢漂移的模糊流体,16 次 Poisson 迭代与 30fps 观感无差,
          // 相比默认 32 次@刷新率(ProMotion 下 120fps)GPU 负载降约一个数量级
          iterationsPoisson={16}
          fpsCap={playing ? 30 : 20}
          // 交互提帧:鼠标划过流体时临时升到 60fps 保证跟手,静置 2 秒回落省电
          interactFpsCap={60}
          autoDemo={true}
          autoSpeed={0.25 + 0.2 * playAmount}
          autoIntensity={1.2 + 0.6 * playAmount}
          autoResumeDelay={2000}
        />
      )}
    </div>
  )
}
