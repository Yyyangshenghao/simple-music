// src/components/Layout/modules/AccountModule.tsx
import { useRef } from 'react'
import { useHoverPanel } from './useHoverPanel'
import styles from './AccountModule.module.css'

export function AccountModule() {
  const panelRef = useRef<HTMLDivElement>(null)
  const { triggerProps, panelProps } = useHoverPanel(panelRef)

  return (
    <>
      <button className={styles.seed} aria-label="账户" {...triggerProps}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v1h20v-1c0-3.3-6.7-5-10-5z" />
        </svg>
      </button>
      <div ref={panelRef} className={styles.panel} {...panelProps}>
        <p className={styles.status}>未登录</p>
        <button className={styles.actionBtn}>登录账号</button>
      </div>
    </>
  )
}
