import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import styles from './RoamSaveHelp.module.css'

export function RoamSaveHelp() {
  const [position, setPosition] = useState<CSSProperties | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLParagraphElement>(null)
  const panelId = useId()
  const open = position !== null

  useEffect(() => {
    if (!open) return
    const dismissOutside = (event: Event) => {
      const target = event.target as Node
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) setPosition(null)
    }
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setPosition(null)
      triggerRef.current?.focus()
    }
    const dismissOnViewportChange = (event: Event) => {
      if (event.type === 'scroll' && panelRef.current?.contains(event.target as Node)) return
      setPosition(null)
    }
    document.addEventListener('pointerdown', dismissOutside)
    document.addEventListener('focusin', dismissOutside)
    document.addEventListener('keydown', dismissOnEscape, true)
    window.addEventListener('resize', dismissOnViewportChange)
    window.addEventListener('scroll', dismissOnViewportChange, true)
    return () => {
      document.removeEventListener('pointerdown', dismissOutside)
      document.removeEventListener('focusin', dismissOutside)
      document.removeEventListener('keydown', dismissOnEscape, true)
      window.removeEventListener('resize', dismissOnViewportChange)
      window.removeEventListener('scroll', dismissOnViewportChange, true)
    }
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.trigger} no-drag`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-describedby={open ? panelId : undefined}
        onClick={() => {
          if (open) {
            setPosition(null)
            return
          }
          const rect = triggerRef.current!.getBoundingClientRect()
          const below = window.innerHeight - rect.bottom - 20
          const above = rect.top - 20
          const openAbove = below < 100 && above > below
          setPosition({
            left: Math.max(12, Math.min(rect.left, window.innerWidth - 372)),
            top: openAbove ? rect.top - 8 : rect.bottom + 8,
            maxHeight: Math.max(0, openAbove ? above : below),
            transform: openAbove ? 'translateY(-100%)' : undefined
          })
        }}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true" data-open={open}><path d="m4 2 4 4-4 4" /></svg>
        保存与同步说明
      </button>
      {position && createPortal(
        <p ref={panelRef} id={panelId} role="note" className={`${styles.panel} no-drag`} style={position}>
          从已启用平台挑选歌手。混合结果只保存在本地，单一网易云来源且已登录时可同步「每日漫游」。
        </p>,
        document.body
      )}
    </>
  )
}
