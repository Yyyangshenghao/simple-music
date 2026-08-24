import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { filterFontFamilies } from '../../lib/font-search'
import type { SystemFontFamily } from '../../types/ipc'
import styles from './SystemFontPicker.module.css'

interface SystemFontPickerProps {
  id: string
  value: string
  fonts: SystemFontFamily[]
  loading: boolean
  defaultLabel?: string
  ariaLabel?: string
  onChange(value: string): void
}

interface FontOption {
  value: string
  label: string
  secondaryLabel?: string
  stored?: boolean
}

interface PopoverPosition {
  top: number
  left: number
  width: number
  maxHeight: number
}

const PANEL_WIDTH = 276
const PANEL_MAX_HEIGHT = 320
const VIEWPORT_GAP = 12

export function SystemFontPicker({
  id,
  value,
  fonts,
  loading,
  defaultLabel = '系统默认',
  ariaLabel,
  onChange
}: SystemFontPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [position, setPosition] = useState<PopoverPosition>({
    top: 0,
    left: 0,
    width: PANEL_WIDTH,
    maxHeight: PANEL_MAX_HEIGHT
  })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listboxId = useId()

  const options = useMemo<FontOption[]>(() => {
    const filtered = filterFontFamilies(fonts, query)
    const keyword = query.trim().toLocaleLowerCase()
    const next: FontOption[] = keyword ? [] : [{ value: '', label: defaultLabel }]
    if (value && !fonts.some((font) => font.family === value) && (!keyword || value.toLocaleLowerCase().includes(keyword))) {
      next.push({ value, label: value, stored: true })
    }
    next.push(...filtered.map((font) => ({
      value: font.family,
      label: font.localizedName || font.family,
      secondaryLabel: font.localizedName ? font.family : undefined
    })))
    return next
  }, [defaultLabel, fonts, query, value])

  function closePicker(restoreFocus = true): void {
    setOpen(false)
    setQuery('')
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus())
  }

  function selectOption(option: FontOption): void {
    onChange(option.value)
    closePicker()
  }

  function updatePosition(): void {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = Math.min(PANEL_WIDTH, window.innerWidth - VIEWPORT_GAP * 2)
    const left = Math.min(
      window.innerWidth - width - VIEWPORT_GAP,
      Math.max(VIEWPORT_GAP, rect.right - width)
    )
    const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_GAP * 2
    const spaceAbove = rect.top - VIEWPORT_GAP * 2
    const openAbove = spaceBelow < 220 && spaceAbove > spaceBelow
    const maxHeight = Math.max(180, Math.min(PANEL_MAX_HEIGHT, openAbove ? spaceAbove : spaceBelow))
    const top = openAbove
      ? Math.max(VIEWPORT_GAP, rect.top - maxHeight - 8)
      : rect.bottom + 8
    setPosition({ top, left, width, maxHeight })
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      closePicker()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!options.length) return
      const direction = event.key === 'ArrowDown' ? 1 : -1
      setActiveIndex((current) => (current + direction + options.length) % options.length)
      return
    }
    if (event.key === 'Enter' && options[activeIndex]) {
      event.preventDefault()
      selectOption(options[activeIndex])
    }
  }

  useLayoutEffect(() => {
    if (!open) return
    updatePosition()
    const frame = requestAnimationFrame(() => searchRef.current?.focus())
    const handleViewportChange = (event: Event) => {
      if (event.type === 'scroll' && panelRef.current?.contains(event.target as Node)) return
      updatePosition()
    }
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) closePicker(false)
    }
    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target as Node
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) closePicker(false)
    }
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('focusin', handleFocusIn)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('focusin', handleFocusIn)
    }
  }, [open])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  useEffect(() => {
    if (activeIndex >= options.length) setActiveIndex(Math.max(0, options.length - 1))
  }, [activeIndex, options.length])

  useEffect(() => {
    if (!open || !options[activeIndex]) return
    document.getElementById(`${listboxId}-${activeIndex}`)?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, listboxId, open, options])

  const selectedFont = fonts.find((font) => font.family === value)
  const selectedLabel = loading
    ? '正在读取…'
    : value
      ? selectedFont?.localizedName ? `${selectedFont.localizedName} · ${value}` : value
      : defaultLabel

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`${styles.trigger} no-drag`}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        disabled={loading}
        onClick={() => {
          if (open) closePicker()
          else setOpen(true)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          event.preventDefault()
          setOpen(true)
        }}
      >
        <span className={styles.preview} style={value ? { fontFamily: value } : undefined} aria-hidden="true">Aa</span>
        <span className={styles.selectedLabel} title={selectedLabel}>{selectedLabel}</span>
        <svg className={styles.chevron} data-open={open} viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          className={styles.panel}
          style={{
            '--font-picker-top': `${position.top}px`,
            '--font-picker-left': `${position.left}px`,
            '--font-picker-width': `${position.width}px`,
            '--font-picker-max-height': `${position.maxHeight}px`
          } as CSSProperties}
        >
          <div className={styles.searchWrap}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4" /><path d="m10 10 3 3" /></svg>
            <input
              ref={searchRef}
              className={`${styles.searchInput} no-drag`}
              role="combobox"
              aria-label="搜索系统字体"
              aria-expanded="true"
              aria-controls={listboxId}
              aria-activedescendant={options[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={`搜索 ${fonts.length} 种字体`}
            />
            {query && (
              <button type="button" className={`${styles.clearButton} no-drag`} onClick={() => setQuery('')} aria-label="清空搜索">×</button>
            )}
          </div>

          <div id={listboxId} className={styles.list} role="listbox" aria-label="系统字体">
            {options.map((option, index) => (
              <button
                id={`${listboxId}-${index}`}
                key={option.value || 'system-default'}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={option.value === value}
                className={`${styles.option} no-drag${index === activeIndex ? ` ${styles.optionActive}` : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectOption(option)}
              >
                <span className={styles.optionPreview} style={option.value ? { fontFamily: option.value } : undefined} aria-hidden="true">Aa</span>
                <span className={styles.optionNames}>
                  <span className={styles.optionLabel}>{option.label}</span>
                  {option.secondaryLabel && <span className={styles.optionSecondary}>{option.secondaryLabel}</span>}
                </span>
                {option.stored && <span className={styles.storedBadge}>存档</span>}
                {option.value === value && <span className={styles.check} aria-hidden="true">✓</span>}
              </button>
            ))}
            {!options.length && <div className={styles.empty}>没有匹配的字体</div>}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
