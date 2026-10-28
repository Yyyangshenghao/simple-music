import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { springSnappy } from '../../lib/motion-presets'
import { useMotion } from '../../hooks/useMotion'
import { useSystemReducedMotion } from '../../hooks/useSystemReducedMotion'
import styles from './Select.module.css'

export interface SelectOption<T extends string> {
  value: T
  label: string
  disabled?: boolean
}

export function selectPosition(rect: Pick<DOMRect, 'left' | 'top' | 'bottom' | 'width'>, viewport: { width: number; height: number }, count: number) {
  const margin = 8
  const gap = 6
  const below = Math.max(0, viewport.height - rect.bottom - margin - gap)
  const above = Math.max(0, rect.top - margin - gap)
  const height = Math.min(260, count * 36 + 12)
  const upwards = below < height && above > below
  const maxHeight = Math.min(height, upwards ? above : below)
  const width = Math.min(Math.max(rect.width, 176), viewport.width - margin * 2)
  return { left: Math.max(margin, Math.min(rect.left, viewport.width - width - margin)), top: upwards ? rect.top - gap - maxHeight : rect.bottom + gap, width, maxHeight, upwards }
}

/** 普通单选下拉；字体等带搜索的专用选择器保留自己的交互。 */
export function Select<T extends string>({ value, onChange, options, 'aria-label': label, id, className = '', disabled = false, placeholder = '请选择' }: {
  value: T
  onChange(value: T): void
  options: readonly SelectOption<T>[]
  'aria-label': string
  id?: string
  className?: string
  disabled?: boolean
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<ReturnType<typeof selectPosition> | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const listId = useId()
  const grow = useMotion('popoverSproutMotion')
  const iconMotion = useMotion('iconMotion')
  const reduced = useSystemReducedMotion()
  const selected = options.find(option => option.value === value)
  const unavailable = disabled || !options.some(option => !option.disabled)
  const visible = open && !unavailable

  useEffect(() => { if (unavailable) setOpen(false) }, [unavailable])
  useLayoutEffect(() => {
    if (!visible || !trigger.current) return
    setPosition(selectPosition(trigger.current.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }, options.length))
    const outside = (event: MouseEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
    }
    const viewport = (event: Event) => {
      if (event.type === 'scroll' && panel.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', outside)
    window.addEventListener('keydown', escape, true)
    window.addEventListener('resize', viewport)
    window.addEventListener('scroll', viewport, true)
    return () => {
      document.removeEventListener('mousedown', outside)
      window.removeEventListener('keydown', escape, true)
      window.removeEventListener('resize', viewport)
      window.removeEventListener('scroll', viewport, true)
    }
  }, [visible, options.length])

  useLayoutEffect(() => {
    if (visible && position && panel.current && !panel.current.matches(':popover-open')) panel.current.showPopover()
  }, [visible, position])

  return <>
    <button ref={trigger} id={id} type="button" className={`${styles.trigger} no-drag ${className}`}
      aria-label={label} aria-haspopup="listbox" aria-expanded={visible} aria-controls={visible ? listId : undefined}
      disabled={unavailable} onClick={() => setOpen(current => !current)}>
      <span className={styles.label} title={selected?.label}>{selected?.label ?? placeholder}</span>
      <motion.svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"
        initial={false} animate={{ rotate: visible ? 180 : 0 }} transition={iconMotion && !reduced ? springSnappy : { duration: 0 }}>
        <path d="m4 6 4 4 4-4" />
      </motion.svg>
    </button>
    {typeof document !== 'undefined' && createPortal(<AnimatePresence initial={false}>
      {visible && position && <motion.div key="options" ref={panel} {...{ popover: 'manual' }} id={listId} role="listbox" aria-label={label}
        className={`${styles.panel} no-drag`} style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight, transformOrigin: position.upwards ? 'bottom' : 'top' }}
        initial={grow && !reduced ? { opacity: 0, scale: .96, y: position.upwards ? 4 : -4 } : false}
        animate={{ opacity: 1, scale: 1, y: 0, pointerEvents: 'auto' }} exit={{ opacity: 0, scale: grow && !reduced ? .98 : 1, pointerEvents: 'none' }}
        transition={grow && !reduced ? springSnappy : { duration: 0 }}>
        {options.map(option => <button key={option.value} type="button" role="option" aria-selected={option.value === value}
          disabled={option.disabled} tabIndex={-1} className={styles.option} title={option.label}
          onClick={() => { if (!option.disabled) { setOpen(false); onChange(option.value) } }}>
          <span>{option.label}</span>
          {option.value === value && <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m3 8 3 3 7-7" /></svg>}
        </button>)}
      </motion.div>}
    </AnimatePresence>, trigger.current?.closest('dialog') ?? document.body)}
  </>
}
