import { useRef } from 'react'
import type { ReactNode } from 'react'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { useAudioEnergy } from '../../hooks/useAudioEnergy'
import { useSettingsStore } from '../../stores/settings'
import { useVisualStore } from '../../stores/visual'
import { GlassPanel } from '../ui/GlassPanel'
import styles from './PlayerGlass.module.css'

interface PlayerGlassProps {
  children?: ReactNode
  /** 沉浸模式:整体淡出并禁用交互，页面视口保持不变 */
  hidden?: boolean
  /** 歌词展开时保留当前主题，玻璃底色融入封面氛围色 */
  lyricsOpen?: boolean
}

/** 播放栏外层毛玻璃容器，固定在视口底部；播放时底部氛围辉光随低频能量呼吸。 */
export function PlayerGlass({ children, hidden, lyricsOpen }: PlayerGlassProps) {
  // --audio-energy 每帧改写:必须直接写在唯一消费它的 glow 元素上。
  // 之前写在 dock 上靠继承传给 glow,整个播放栏子树每帧全量样式重算,
  // Blink 堆垃圾以数十 MB/s 产生且 V8 GC 很少触发,内存随播放无限涨。
  // 辉光垫在玻璃面板后方,30fps 的能量呼吸会迫使面板 backdrop-filter 持续重取样,
  // 极简模式(audioGlowEffect=false)整个元素不渲染,归零这份 GPU 常驻负载
  const glowRequested = useSettingsStore((s) => s.performance.audioGlowEffect)
  const reducedMotion = useReducedMotion()
  const eco = useVisualStore((s) => s.performanceMode === 'eco')
  const glowEnabled = glowRequested && !reducedMotion && !eco && !hidden
  const glowRef = useRef<HTMLDivElement>(null)
  useAudioEnergy(glowRef, glowEnabled)

  return (
    <div className={`${styles.dock}${lyricsOpen ? ` ${styles.lyrics}` : ''}${hidden ? ` ${styles.hidden}` : ''}`}>
      {glowEnabled && <div className={styles.glow} aria-hidden="true" ref={glowRef} />}
      <GlassPanel className={styles.panel}>{children}</GlassPanel>
    </div>
  )
}
