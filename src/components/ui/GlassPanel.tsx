import type { CSSProperties, ReactNode } from 'react'
import styles from './GlassPanel.module.css'

interface GlassPanelProps {
  children?: ReactNode
  className?: string
  style?: CSSProperties
}

/** 毛玻璃容器：统一的半透明面板底。 */
export function GlassPanel({ children, className, style }: GlassPanelProps) {
  return (
    <div className={`${styles.panel}${className ? ` ${className}` : ''}`} style={style}>
      {children}
    </div>
  )
}
