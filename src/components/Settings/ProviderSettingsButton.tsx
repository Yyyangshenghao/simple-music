import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { useMotion } from '../../hooks/useMotion'
import { useSystemReducedMotion } from '../../hooks/useSystemReducedMotion'
import { springSnappy } from '../../lib/motion-presets'
import styles from './ProviderSettingsButton.module.css'

const PANEL_WIDTH = 680
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

/** 平台专属设置：面板从音源行的齿轮向左展开，不挤动页面布局。 */
export function ProviderSettingsButton({ label, disabled = false, children }: { label: string; disabled?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const grow = useMotion('popoverSproutMotion')
  const reduced = useSystemReducedMotion()
  const animate = grow && !reduced

  const visible = open && !disabled
  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }) }

  useEffect(() => { if (disabled) setOpen(false) }, [disabled])

  useLayoutEffect(() => {
    if (!visible || !trigger.current) return
    const place = () => {
      const rect = trigger.current!.getBoundingClientRect()
      const clearance = parseFloat(getComputedStyle(trigger.current!).getPropertyValue('--sm-player-clearance')) || 0
      const topBoundary = 64
      const bottom = window.innerHeight - clearance - MARGIN
      const maxHeight = Math.max(120, bottom - topBoundary)
      const leftBoundary = Math.max(MARGIN, trigger.current!.closest('section')?.getBoundingClientRect().left ?? MARGIN)
      const width = Math.max(0, rect.left - GAP - leftBoundary)
      const height = Math.min(panel.current?.scrollHeight || maxHeight, maxHeight)
      const top = Math.max(topBoundary, Math.min(rect.top - 18, bottom - height))
      setPosition({ left: rect.left - GAP - width, top, width, maxHeight })
    }
    place()
    // 首帧拿到面板高度后重新避让顶栏与播放栏。
    const frame = requestAnimationFrame(place)
    return () => cancelAnimationFrame(frame)
  }, [visible])

  useLayoutEffect(() => {
    if (visible && position && panel.current && !panel.current.matches(':popover-open')) {
      panel.current.showPopover()
      panel.current.querySelector<HTMLButtonElement>('[data-panel-close]')?.focus({ preventScroll: true })
    }
  }, [visible, position])

  useEffect(() => {
    if (!visible) return
    // 面板里的下拉选项渲染在 body 上，点选项不算点外部。
    const inside = (target: EventTarget | null) => target instanceof Node && (
      !!trigger.current?.contains(target) || !!panel.current?.contains(target)
      || (target instanceof Element && !!target.closest('[role="listbox"]')))
    const outside = (event: PointerEvent) => { if (!inside(event.target)) setOpen(false) }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return
      // 面板内下拉开着时 Esc 先收下拉。
      if (document.querySelector('[role="listbox"]')) return
      close()
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
  }, [visible])

  return <>
    <button ref={trigger} type="button" className={`${styles.trigger} no-drag`} data-open={visible || undefined}
      disabled={disabled} aria-label={label} data-tip={disabled ? '启用音源后可设置' : label} aria-haspopup="dialog" aria-expanded={visible} aria-controls={visible ? panelId : undefined}
      onClick={() => setOpen(current => !current)}>
      <GearIcon />
    </button>
    {typeof document !== 'undefined' && createPortal(<AnimatePresence initial={false} onExitComplete={() => setPosition(null)}>
      {visible && <motion.div key="panel" ref={panel} {...{ popover: 'manual' }} id={panelId} role="dialog" aria-label={label}
        className={`${styles.panel} no-drag`}
        style={{ left: position?.left ?? -9999, top: position?.top ?? 0, width: position?.width ?? PANEL_WIDTH, maxHeight: position?.maxHeight, transformOrigin: 'right top' }}
        initial={animate ? { opacity: 0, scale: .98, x: 8 } : false}
        animate={{ opacity: 1, scale: 1, x: 0, pointerEvents: 'auto' }}
        exit={{ opacity: 0, scale: animate ? .98 : 1, pointerEvents: 'none' }}
        transition={animate ? springSnappy : { duration: 0 }}>
        <header className={styles.heading}>
          <h2>{label}</h2>
          <button type="button" data-panel-close className={styles.close} aria-label={`关闭${label}`} data-tip="关闭" onClick={close}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>
        <div className={styles.body} data-provider-settings-scroll>{children}</div>
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
