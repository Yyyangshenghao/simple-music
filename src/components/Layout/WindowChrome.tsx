import type { ReactNode } from 'react'
import { useWindowStore } from '../../stores/window'
import styles from './WindowChrome.module.css'

interface WindowChromeProps {
  children: ReactNode
}

export function WindowChrome({ children }: WindowChromeProps) {
  const isFullScreen = useWindowStore((s) => s.isFullScreen)
  return (
    <div className={`${styles.chrome}${isFullScreen ? ` ${styles.fullScreen}` : ''}`}>
      {children}
    </div>
  )
}
