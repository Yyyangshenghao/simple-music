import { useState, useRef, useEffect } from 'react'
import { useSettingsStore } from '../../stores/settings'
import styles from './SourceSwitcher.module.css'

const SOURCES = [
  { key: 'netease' as const, label: '网易云' },
  { key: 'qq' as const, label: 'QQ 音乐' },
]

export function SourceSwitcher() {
  const [open, setOpen] = useState(false)
  const activeSource = useSettingsStore((s) => s.activeSource)
  const setActiveSource = useSettingsStore((s) => s.setActiveSource)
  const ref = useRef<HTMLDivElement>(null)

  const current = SOURCES.find((s) => s.key === activeSource) ?? SOURCES[0]

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className={styles.root} ref={ref}>
      <button className={`${styles.badge} no-drag`} onClick={() => setOpen((v) => !v)}>
        <span className={styles.dot} />
        {current.label}
      </button>
      {open && (
        <div className={styles.menu}>
          {SOURCES.map((s) => (
            <button
              key={s.key}
              className={`${styles.option} no-drag ${s.key === activeSource ? styles.active : ''}`}
              onClick={() => { setActiveSource(s.key); setOpen(false) }}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
