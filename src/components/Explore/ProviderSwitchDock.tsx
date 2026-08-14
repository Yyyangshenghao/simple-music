import { useEffect, useRef, useState } from 'react'
import { providerFor } from '../../providers/registry'
import type { ProviderId } from '../../providers/types'
import { NeteaseLogo, QQMusicLogo } from '../ui/brand-logos'
import styles from './ProviderSwitchDock.module.css'

interface ProviderSwitchDockProps {
  sources: ProviderId[]
  current: ProviderId
  onSelect(source: ProviderId): void
  heading?: string
  ariaLabel?: string
}

function ProviderLogo({ source }: { source: ProviderId }) {
  const descriptor = providerFor(source).descriptor
  if (descriptor.iconKey === 'netease') return <NeteaseLogo />
  if (descriptor.iconKey === 'qq') return <QQMusicLogo />
  return <span className={styles.fallbackLogo}>{descriptor.label.slice(0, 1)}</span>
}

export function ProviderSwitchDock({
  sources,
  current,
  onSelect,
  heading = '内容平台',
  ariaLabel = '切换内容平台',
}: ProviderSwitchDockProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLElement>(null)
  const closeTimerRef = useRef<number | null>(null)
  const currentColor = providerFor(current).descriptor.color

  function cancelClose(): void {
    if (closeTimerRef.current === null) return
    window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
  }

  function show(): void {
    cancelClose()
    setOpen(true)
  }

  function scheduleClose(): void {
    cancelClose()
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false)
      closeTimerRef.current = null
    }, 180)
  }

  useEffect(() => () => cancelClose(), [])

  return (
    <nav
      ref={rootRef}
      className={`${styles.root}${open ? ` ${styles.open}` : ''}`}
      aria-label={ariaLabel}
      style={{ '--dock-color': currentColor } as React.CSSProperties}
      onMouseEnter={show}
      onMouseLeave={scheduleClose}
      onFocus={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) show()
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) scheduleClose()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          cancelClose()
          setOpen(false)
          rootRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
          return
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
        const options = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [])
        if (options.length === 0) return
        const currentIndex = Math.max(0, options.indexOf(document.activeElement as HTMLButtonElement))
        const nextIndex = event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? options.length - 1
            : (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
        event.preventDefault()
        options[nextIndex].focus()
        options[nextIndex].click()
      }}
    >
      <div className={styles.panel} role="radiogroup" aria-orientation="vertical">
        <div className={styles.heading} aria-hidden={!open}>
          <span>{heading}</span>
          <span className={styles.signal} />
        </div>
        <div className={styles.options}>
          {sources.map((source) => {
            const descriptor = providerFor(source).descriptor
            const active = source === current
            return (
              <button
                key={source}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={`切换到${descriptor.label}`}
                tabIndex={active ? 0 : -1}
                title={!open ? descriptor.label : undefined}
                className={`${styles.option}${active ? ` ${styles.active}` : ''} no-drag`}
                style={{ '--provider-color': descriptor.color } as React.CSSProperties}
                onClick={() => {
                  if (active) {
                    show()
                    return
                  }
                  onSelect(source)
                  cancelClose()
                  setOpen(false)
                }}
              >
                <span className={styles.logo} aria-hidden="true"><ProviderLogo source={source} /></span>
                <span className={styles.label}>{descriptor.label}</span>
                <span className={styles.activeDot} aria-hidden="true" />
              </button>
            )
          })}
        </div>
        <span className={styles.edgeHint} aria-hidden="true" />
      </div>
    </nav>
  )
}
