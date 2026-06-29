// src/components/Layout/modules/SourceModule.tsx
import { useRef } from 'react'
import { useSettingsStore } from '../../../stores/settings'
import { useHoverPanel } from './useHoverPanel'
import styles from './SourceModule.module.css'

const SOURCES = [
  { key: 'netease' as const, label: '网易云' },
  { key: 'qq' as const, label: 'QQ 音乐' },
]

export function SourceModule() {
  const panelRef = useRef<HTMLDivElement>(null)
  const { triggerProps, panelProps } = useHoverPanel(panelRef)
  const activeSource = useSettingsStore((s) => s.activeSource)
  const setActiveSource = useSettingsStore((s) => s.setActiveSource)

  return (
    <>
      <button className={styles.seed} aria-label="音源" {...triggerProps}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z" />
        </svg>
        <span className={styles.dot} aria-hidden="true" />
      </button>
      <div ref={panelRef} className={styles.panel} {...panelProps}>
        {SOURCES.map((s) => (
          <button
            key={s.key}
            className={`${styles.option} ${s.key === activeSource ? styles.active : ''}`}
            onClick={() => setActiveSource(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>
    </>
  )
}
