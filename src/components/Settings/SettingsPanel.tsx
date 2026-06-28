import { useEffect, useState } from 'react'
import { GlassPanel } from '../ui/GlassPanel'
import { VisualSettings } from './VisualSettings'
import { HotkeySettings } from './HotkeySettings'
import { AccountSettings } from './AccountSettings'
import styles from './SettingsPanel.module.css'

type Tab = 'visual' | 'hotkey' | 'account'

interface SettingsPanelProps {
  open: boolean
  onClose: () => void
}

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'visual', label: '视觉' },
  { id: 'hotkey', label: '快捷键' },
  { id: 'account', label: '账号' }
]

/** 设置面板：带分区标签页的毛玻璃容器。open=false 时不渲染。 */
export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const [tab, setTab] = useState<Tab>('visual')

  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={`${styles.dialog} no-drag`} onClick={(e) => e.stopPropagation()}>
        <GlassPanel className={styles.panel}>
          <header className={styles.header}>
            <h2 className={styles.title}>设置</h2>
            <button type="button" className={styles.close} aria-label="关闭" title="关闭" onClick={onClose}>
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                <line x1="3.5" y1="3.5" x2="10.5" y2="10.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                <line x1="10.5" y1="3.5" x2="3.5" y2="10.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          </header>

          <nav className={styles.tabs}>
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`${styles.tab}${tab === t.id ? ` ${styles.tabActive}` : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className={styles.body}>
            {tab === 'visual' && <VisualSettings />}
            {tab === 'hotkey' && <HotkeySettings />}
            {tab === 'account' && <AccountSettings />}
          </div>
        </GlassPanel>
      </div>
    </div>
  )
}
