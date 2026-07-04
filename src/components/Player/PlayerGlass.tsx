import { useRef } from 'react'
import type { ReactNode } from 'react'
import { useAudioEnergy } from '../../hooks/useAudioEnergy'
import { GlassPanel } from '../ui/GlassPanel'
import styles from './PlayerGlass.module.css'

interface PlayerGlassProps {
  children?: ReactNode
}

/** 播放栏外层毛玻璃容器，固定在视口底部；播放时底部氛围辉光随低频能量呼吸。 */
export function PlayerGlass({ children }: PlayerGlassProps) {
  const dockRef = useRef<HTMLDivElement>(null)
  useAudioEnergy(dockRef)

  return (
    <div className={styles.dock} ref={dockRef}>
      <div className={styles.glow} aria-hidden="true" />
      <GlassPanel className={styles.panel}>{children}</GlassPanel>
    </div>
  )
}
