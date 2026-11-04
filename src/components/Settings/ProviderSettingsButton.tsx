import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { useMotion } from '../../hooks/useMotion'
import { useSystemReducedMotion } from '../../hooks/useSystemReducedMotion'
import { springSnappy } from '../../lib/motion-presets'
import styles from './ProviderSettingsButton.module.css'

const PANEL_WIDTH = 300
const MARGIN = 8
const GAP = 6

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

/** 平台专属设置：音源行里的齿轮，点开在行旁弹出可操作面板，不挤动设置页布局。 */
export function ProviderSettingsButton({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ left: number; top: number; upwards: boolean } | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const grow = useMotion('popoverSproutMotion')
  const reduced = useSystemReducedMotion()
  const animate = grow && !reduced

  useLayoutEffect(() => {
    if (!open || !trigger.current) return
    const place = () => {
      const rect = trigger.current!.getBoundingClientRect()
      const height = panel.current?.offsetHeight ?? 0
      // 底部播放条占住的区域也算不可用，避免面板压在播放条上。
      const clearance = parseFloat(getComputedStyle(trigger.current!).getPropertyValue('--sm-player-clearance')) || 0
      const upwards = rect.bottom + GAP + height + MARGIN > window.innerHeight - clearance && rect.top - GAP - height > MARGIN
      const left = Math.max(MARGIN, Math.min(rect.right - PANEL_WIDTH, window.innerWidth - PANEL_WIDTH - MARGIN))
      setPosition({ left, top: upwards ? rect.top - GAP - height : rect.bottom + GAP, upwards })
    }
    place()
    // 首帧拿到面板高度后再定一次上下方向。
    const frame = requestAnimationFrame(place)
    return () => cancelAnimationFrame(frame)
  }, [open])

  useLayoutEffect(() => {
    if (open && position && panel.current && !panel.current.matches(':popover-open')) panel.current.showPopover()
  }, [open, position])

  useEffect(() => {
    if (!open) return
    // 面板里的下拉选项渲染在 body 上，点选项不算点外部。
    const inside = (target: EventTarget | null) => target instanceof Node && (
      !!trigger.current?.contains(target) || !!panel.current?.contains(target)
      || (target instanceof Element && !!target.closest('[role="listbox"]')))
    const outside = (event: PointerEvent) => { if (!inside(event.target)) setOpen(false) }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return
      // 面板内下拉开着时 Esc 先收下拉。
      if (document.querySelector('[role="listbox"]')) return
      setOpen(false)
    }
    const viewport = (event: Event) => {
      if (event.type === 'scroll' && inside(event.target)) return
      setOpen(false)
    }
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('keydown', escape, true)
    window.addEventListener('resize', viewport)
    window.addEventListener('scroll', viewport, true)
    return () => {
      window.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('keydown', escape, true)
      window.removeEventListener('resize', viewport)
      window.removeEventListener('scroll', viewport, true)
    }
  }, [open])

  return <>
    <button ref={trigger} type="button" className={`${styles.trigger} no-drag`} data-open={open || undefined}
      aria-label={label} title={label} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined}
      onClick={() => setOpen(current => !current)}>
      <GearIcon />
    </button>
    {typeof document !== 'undefined' && createPortal(<AnimatePresence initial={false} onExitComplete={() => setPosition(null)}>
      {open && <motion.div key="panel" ref={panel} {...{ popover: 'manual' }} id={panelId} role="dialog" aria-label={label}
        className={`${styles.panel} no-drag`}
        style={{ left: position?.left ?? -9999, top: position?.top ?? 0, width: PANEL_WIDTH, transformOrigin: position?.upwards ? 'bottom right' : 'top right' }}
        initial={animate ? { opacity: 0, scale: .96, y: position?.upwards ? 4 : -4 } : false}
        animate={{ opacity: 1, scale: 1, y: 0, pointerEvents: 'auto' }}
        exit={{ opacity: 0, scale: animate ? .98 : 1, pointerEvents: 'none' }}
        transition={animate ? springSnappy : { duration: 0 }}>
        {children}
      </motion.div>}
    </AnimatePresence>, document.body)}
  </>
}

/** 面板内的一项：名称 + 必要说明在左，控件在右。 */
export function ProviderSettingItem({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className={styles.item}>
      <div className={styles.itemText}>
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </div>
      <div className={styles.itemControl}>{children}</div>
    </div>
  )
}

/** 没有专属设置的平台占位，保持开关与账号按钮跨行对齐。 */
export function ProviderSettingsPlaceholder() {
  return <span className={styles.placeholder} aria-hidden="true" />
}
