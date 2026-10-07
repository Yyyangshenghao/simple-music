import { useEffect, useRef, useState, type RefObject, type MouseEvent, type PointerEvent, type KeyboardEvent, type DragEvent } from 'react'
import { applySelection, intersectsSelection, rangeSelection, selectionRect, selectionScrollDelta, virtualSelectionKeys, type SelectionRect } from '../lib/multi-selection'

interface Options {
  enabled: boolean
  keys: string[]
  disabledKeys?: string[]
  resetKey: string
  onExit(): void
  virtual?: { listRef: RefObject<HTMLDivElement>; rowHeight: number }
}

export function useMultiSelection(options: Options) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [marquee, setMarquee] = useState<SelectionRect | null>(null)
  const anchor = useRef<string | null>(null)
  const finish = useRef<(() => void) | null>(null)
  const suppressClick = useRef(false)
  const current = useRef({ options, selected })
  current.current = { options, selected }
  const keysSignature = options.keys.join('\u0000')

  useEffect(() => {
    finish.current?.()
    setSelected(new Set())
    anchor.current = null
    return () => { finish.current?.() }
  }, [options.enabled, options.resetKey])
  useEffect(() => {
    finish.current?.()
    const allowed = new Set(options.keys.filter(key => !options.disabledKeys?.includes(key)))
    setSelected(previous => new Set([...previous].filter(key => allowed.has(key))))
  }, [keysSignature, options.disabledKeys?.join('\u0000')])

  function allowedKeys() {
    const { keys, disabledKeys = [] } = current.current.options
    const disabled = new Set(disabledKeys)
    return keys.filter(key => !disabled.has(key))
  }
  function clear() { finish.current?.(); anchor.current = null; setSelected(new Set()) }
  function selectAll() { finish.current?.(); setSelected(new Set(allowedKeys())) }
  function exit() { finish.current?.(); clear(); current.current.options.onExit() }

  function onClickCapture(event: MouseEvent<HTMLDivElement>) {
    if (!current.current.options.enabled) return
    if (suppressClick.current) { suppressClick.current = false; event.preventDefault(); event.stopPropagation(); return }
    const item = (event.target as Element).closest<HTMLElement>('[data-selection-key]')
    if (!item || !rootRef.current?.contains(item)) return
    event.preventDefault()
    event.stopPropagation()
    const key = item.dataset.selectionKey!
    const keys = allowedKeys()
    if (!keys.includes(key)) return
    if (event.shiftKey) {
      const range = rangeSelection(keys, anchor.current, key)
      setSelected(previous => applySelection(previous, range, event.metaKey || event.ctrlKey ? 'add' : 'replace'))
      if (!anchor.current) anchor.current = key
    } else {
      setSelected(previous => applySelection(previous, [key], 'toggle'))
      anchor.current = key
    }
  }

  function onPointerDownCapture(event: PointerEvent<HTMLDivElement>) {
    suppressClick.current = false
    const root = rootRef.current
    if (!current.current.options.enabled || !root || event.button !== 0 || event.pointerType === 'touch') return
    const target = event.target as Element
    const item = target.closest<HTMLElement>('[data-selection-key]')
    if (!item && target.closest('button, input, select, textarea, a, [role="button"]')) return
    if (item && !allowedKeys().includes(item.dataset.selectionKey!)) return
    finish.current?.()
    let scroll: HTMLElement | null = root
    while (scroll && !/(auto|scroll)/.test(getComputedStyle(scroll).overflowY)) scroll = scroll.parentElement
    const viewport = scroll ?? root
    const startScroll = viewport.scrollTop
    const x = event.clientX, y = event.clientY, pointerId = event.pointerId
    let lastX = x, lastY = y, active = false, frame = 0
    const base = new Set(current.current.selected)
    const mode = event.metaKey || event.ctrlKey ? 'toggle' : event.shiftKey ? 'add' : 'replace'
    const itemKey = item?.dataset.selectionKey ?? null
    if (!target.closest('button, input, select, textarea, a')) root.focus({ preventScroll: true })

    function update(scrollEdge = true) {
      if (!active) return
      const viewportBounds = viewport.getBoundingClientRect()
      const viewportStyle = getComputedStyle(viewport)
      const bounds = {
        left: viewportBounds.left,
        right: viewportBounds.right,
        top: viewportBounds.top + (parseFloat(viewportStyle.scrollPaddingTop) || 0),
        bottom: viewportBounds.bottom - (parseFloat(viewportStyle.scrollPaddingBottom) || 0),
      }
      const delta = selectionScrollDelta(lastY, bounds)
      if (delta && scrollEdge) viewport.scrollTop += delta
      const rect = selectionRect(x, y - (viewport.scrollTop - startScroll), lastX, lastY)
      rect.right = Math.max(rect.right, rect.left + 1)
      rect.bottom = Math.max(rect.bottom, rect.top + 1)
      const { options: latest } = current.current
      let hits: string[]
      const list = latest.virtual?.listRef.current
      if (list && latest.virtual) hits = virtualSelectionKeys(rect, list.getBoundingClientRect(), latest.virtual.rowHeight, latest.keys)
      else hits = Array.from(root!.querySelectorAll<HTMLElement>('[data-selection-key]'))
        .filter(node => intersectsSelection(rect, node.getBoundingClientRect())).map(node => node.dataset.selectionKey!)
      const disabled = new Set(latest.disabledKeys)
      const next = applySelection(base, hits.filter(key => !disabled.has(key)), mode)
      setSelected(previous => previous.size === next.size && [...next].every(key => previous.has(key)) ? previous : next)
      setMarquee({ left: Math.max(rect.left, bounds.left), right: Math.min(rect.right, bounds.right), top: Math.max(rect.top, bounds.top), bottom: Math.min(rect.bottom, bounds.bottom) })
      if (scrollEdge) frame = requestAnimationFrame(() => update())
    }
    function move(e: globalThis.PointerEvent) {
      if (e.pointerId !== pointerId) return
      lastX = e.clientX; lastY = e.clientY
      if (!active && Math.hypot(lastX - x, lastY - y) >= 6) {
        active = true
        root!.setPointerCapture(pointerId)
        anchor.current = itemKey
        frame = requestAnimationFrame(() => update())
      }
      if (active) { e.preventDefault(); e.stopPropagation() }
    }
    function stop() {
      if (frame) cancelAnimationFrame(frame)
      if (root!.hasPointerCapture(pointerId)) root!.releasePointerCapture(pointerId)
      if (active) suppressClick.current = true
      active = false
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', cancel, true)
      window.removeEventListener('blur', stop)
      setMarquee(null)
      finish.current = null
    }
    function up(e: globalThis.PointerEvent) {
      if (e.pointerId !== pointerId) return
      lastX = e.clientX; lastY = e.clientY
      if (active) update(false)
      stop()
    }
    function cancel(e: globalThis.PointerEvent) { if (e.pointerId === pointerId) stop() }
    finish.current = stop
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', cancel, true)
    window.addEventListener('blur', stop)
  }

  function onKeyDownCapture(event: KeyboardEvent<HTMLDivElement>) {
    suppressClick.current = false
    if (!current.current.options.enabled || (event.target as Element).closest('input, textarea, select, [contenteditable="true"]')) return
    if (event.target === rootRef.current && event.key === ' ' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) { event.preventDefault(); event.stopPropagation(); return }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); event.stopPropagation(); selectAll() }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); exit() }
  }
  function onDragStartCapture(event: DragEvent<HTMLDivElement>) { if (current.current.options.enabled) event.preventDefault() }

  return { rootRef, selected, clear, selectAll, exit, marquee, surfaceProps: { onClickCapture, onPointerDownCapture, onKeyDownCapture, onDragStartCapture, tabIndex: -1, 'data-selecting': options.enabled } }
}
