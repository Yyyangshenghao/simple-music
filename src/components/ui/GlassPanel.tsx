import type { CSSProperties, ReactNode } from 'react'
import styles from './GlassPanel.module.css'

type GlassLevel = 'base' | 'card' | 'modal'

interface GlassPanelProps {
  children?: ReactNode
  className?: string
  style?: CSSProperties
  level?: GlassLevel
}

export function GlassPanel({ children, className, style, level = 'base' }: GlassPanelProps) {
  const cls = [styles.panel, styles[level], className].filter(Boolean).join(' ')
  return (
    <div className={cls} style={style}>
      {children}
    </div>
  )
}
