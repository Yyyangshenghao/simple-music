// src/components/Layout/modules/NavModule.tsx
import { useRef } from 'react'
import { useNavigationStore } from '../../../stores/navigation'
import type { AppView } from '../../../stores/navigation'
import { FlowingMenu } from '../FlowingMenu/FlowingMenu'
import { useHoverPanel } from './useHoverPanel'
import styles from './NavModule.module.css'

const NAV_ITEMS: { view: AppView; label: string }[] = [
  { view: 'explore', label: '探索' },
  { view: 'library', label: '我的库' },
  { view: 'settings', label: '设置' },
]

export function NavModule() {
  const currentView = useNavigationStore((s) => s.currentView)
  const navigateTo = useNavigationStore((s) => s.navigateTo)
  const panelRef = useRef<HTMLDivElement>(null)
  const { triggerProps, panelProps } = useHoverPanel(panelRef)

  const isActive = typeof currentView === 'string' && NAV_ITEMS.some((n) => n.view === currentView)

  const menuItems = NAV_ITEMS.map((n) => ({
    text: n.label,
    active: currentView === n.view,
    onClick: () => navigateTo(n.view),
  }))

  return (
    <>
      <button
        className={`${styles.seed} ${isActive ? styles.active : ''}`}
        aria-label="导航"
        {...triggerProps}
      >
        {/* 网格图标 */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      </button>
      <div ref={panelRef} className={styles.panel} {...panelProps}>
        <FlowingMenu items={menuItems} />
      </div>
    </>
  )
}
