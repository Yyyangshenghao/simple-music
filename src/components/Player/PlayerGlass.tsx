import { useRef } from 'react'
import type { ReactNode } from 'react'
import { useAudioEnergy } from '../../hooks/useAudioEnergy'
import { GlassPanel } from '../ui/GlassPanel'
import styles from './PlayerGlass.module.css'

interface PlayerGlassProps {
  children?: ReactNode
  /** 沉浸模式:整体淡出并禁用交互,布局占位不变 */
  hidden?: boolean
}

/** 播放栏外层毛玻璃容器，固定在视口底部；播放时底部氛围辉光随低频能量呼吸。 */
export function PlayerGlass({ children, hidden }: PlayerGlassProps) {
  // --audio-energy 每帧改写:必须直接写在唯一消费它的 glow 元素上。
  // 之前写在 dock 上靠继承传给 glow,整个播放栏子树每帧全量样式重算,
  // Blink 堆垃圾以数十 MB/s 产生且 V8 GC 很少触发,内存随播放无限涨。
  const glowRef = useRef<HTMLDivElement>(null)
  useAudioEnergy(glowRef)

  return (
    <div className={`${styles.dock}${hidden ? ` ${styles.hidden}` : ''}`}>
      <div className={styles.glow} aria-hidden="true" ref={glowRef} />
      <GlassPanel className={styles.panel}>{children}</GlassPanel>
    </div>
  )
}
