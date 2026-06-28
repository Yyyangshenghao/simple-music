import type { ReactNode } from 'react'
import { GlassPanel } from '../ui/GlassPanel'
import styles from './PlayerGlass.module.css'

interface PlayerGlassProps {
  children?: ReactNode
}

/** 播放栏外层毛玻璃容器，固定在视口底部。 */
export function PlayerGlass({ children }: PlayerGlassProps) {
  return (
    <div className={styles.dock}>
      <GlassPanel className={styles.panel}>{children}</GlassPanel>
    </div>
  )
}
