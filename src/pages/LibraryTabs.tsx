import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { springSnappy } from '../lib/motion-presets'
import { useReducedMotion } from '../hooks/useReducedMotion'
import styles from './LibraryPage.module.css'

interface TabItem<T extends string> { value: T; label: string }

export function LibraryTabs<T extends string>({ items, value, onChange }: {
  items: TabItem<T>[]
  value: T
  onChange(value: T): void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const gesture = useRef<{ pointer: number; start: number; index: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  const [pill, setPill] = useState<{ x: number; width: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const reducedMotion = useReducedMotion()

  function buttons() { return Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []) }
  function measure(index: number) {
    const button = buttons()[index]
    if (button) setPill({ x: button.offsetLeft, width: button.offsetWidth })
  }
  function nearest(clientX: number) {
    let index = 0
    let distance = Infinity
    buttons().forEach((button, i) => {
      const rect = button.getBoundingClientRect()
      const next = Math.abs(clientX - rect.left - rect.width / 2)
      if (next < distance) { distance = next; index = i }
    })
    return index
  }
  function resetGesture() {
    gesture.current = null
    setDragging(false)
    measure(items.findIndex(item => item.value === value))
  }

  useEffect(() => {
    const update = () => measure(items.findIndex(item => item.value === value))
    update()
    const observer = new ResizeObserver(update)
    if (rootRef.current) observer.observe(rootRef.current)
    for (const button of buttons()) observer.observe(button)
    return () => observer.disconnect()
  }, [items, value])

  return <div
    ref={rootRef}
    className={`${styles.subTabs} no-drag`}
    role="group"
    aria-label="我的库分类"
    data-arrow-navigation
    data-ready={!!pill}
    data-dragging={dragging}
    onPointerDown={event => {
      if (event.button !== 0) return
      suppressClick.current = false
      gesture.current = { pointer: event.pointerId, start: event.clientX, index: nearest(event.clientX), moved: false }
      event.currentTarget.setPointerCapture(event.pointerId)
    }}
    onPointerMove={event => {
      const current = gesture.current
      const root = rootRef.current
      if (!current || current.pointer !== event.pointerId || !root) return
      if (!current.moved && Math.abs(event.clientX - current.start) < 6) return
      current.moved = true
      current.index = nearest(event.clientX)
      setDragging(true)
      const button = buttons()[current.index]
      if (!button) return
      const x = event.clientX - root.getBoundingClientRect().left + root.scrollLeft - button.offsetWidth / 2
      setPill({ x: Math.max(3, Math.min(root.scrollWidth - button.offsetWidth - 3, x)), width: button.offsetWidth })
      button.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
    }}
    onPointerUp={event => {
      const current = gesture.current
      if (!current || current.pointer !== event.pointerId) return
      suppressClick.current = current.moved
      const index = current.moved ? current.index : nearest(event.clientX)
      gesture.current = null
      setDragging(false)
      if (items[index]) { measure(index); onChange(items[index].value); buttons()[index]?.focus({ preventScroll: true }) }
    }}
    onPointerCancel={resetGesture}
    onLostPointerCapture={() => { if (gesture.current) resetGesture() }}
    onClickCapture={event => {
      if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false }
    }}
  >
    {pill && <motion.span
      className={styles.tabPill}
      aria-hidden="true"
      initial={false}
      animate={{ x: pill.x, width: pill.width, scaleY: dragging && !reducedMotion ? 0.94 : 1 }}
      transition={dragging || reducedMotion ? { duration: 0 } : springSnappy}
    />}
    {items.map((item, index) => <button
      key={item.value}
      type="button"
      className={`${styles.subTab} ${value === item.value ? styles.subTabActive : ''}`}
      aria-pressed={value === item.value}
      onClick={() => onChange(item.value)}
      onKeyDown={event => {
        if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
        const next = event.key === 'ArrowRight' ? (index + 1) % items.length
          : event.key === 'ArrowLeft' ? (index - 1 + items.length) % items.length
            : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : -1
        if (next < 0) return
        event.preventDefault()
        onChange(items[next].value)
        buttons()[next]?.focus()
      }}
    >{item.label}</button>)}
  </div>
}
