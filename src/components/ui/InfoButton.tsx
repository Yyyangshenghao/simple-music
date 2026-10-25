import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { RevealText } from './RevealText'
import styles from './InfoButton.module.css'

/** 收起后等淡出过渡走完再卸载示意与逐字节点。 */
const UNMOUNT_DELAY = 200

function positionTooltip(anchor: HTMLSpanElement): void {
  const tooltip = anchor.querySelector<HTMLSpanElement>('[data-info-tooltip]')
  if (!tooltip) return
  const bounds = anchor.getBoundingClientRect()
  const height = tooltip.offsetHeight
  const margin = 12
  const style = getComputedStyle(anchor)
  const section = anchor.closest<HTMLElement>('[id^="settings-detail-"]')
  const topInset = Math.max(
    parseFloat(style.getPropertyValue('--sm-topbar-height')) || 0,
    section ? parseFloat(getComputedStyle(section).scrollMarginTop) || 0 : 0
  )
  const minTop = topInset + margin
  const maxBottom = window.innerHeight - (parseFloat(style.getPropertyValue('--sm-player-clearance')) || 0) - margin
  let top = bounds.bottom + 8
  if (top + height > maxBottom) top = bounds.top - height - 8
  top = Math.max(minTop, Math.min(top, maxBottom - height))
  tooltip.style.top = `${top - bounds.top}px`
}

/**
 * ⓘ 说明：悬停时才挂载动效示意与逐字节点，收起后卸载。
 * 设置页常驻几十个说明，全部预先渲染会让隐藏的循环示意持续占用样式计算。
 */
export function InfoButton({ label, text: description, align = 'right', preview }: { label: string; text: string; align?: 'left' | 'right'; preview?: ReactNode }) {
  const tooltipId = useId()
  const wrapRef = useRef<HTMLSpanElement>(null)
  const unmountTimer = useRef<ReturnType<typeof setTimeout>>()
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)

  // 先以收起态挂载并定位（同时强制一次样式计算），再展开，淡入与逐字过渡才会从头播放。
  useLayoutEffect(() => {
    if (!mounted || open || unmountTimer.current) return
    if (wrapRef.current) positionTooltip(wrapRef.current)
    setOpen(true)
  }, [mounted, open])
  useEffect(() => () => clearTimeout(unmountTimer.current), [])

  function show(): void {
    clearTimeout(unmountTimer.current)
    unmountTimer.current = undefined
    if (!mounted) { setMounted(true); return }
    if (wrapRef.current) positionTooltip(wrapRef.current)
    setOpen(true)
  }
  function hide(): void {
    setOpen(false)
    clearTimeout(unmountTimer.current)
    unmountTimer.current = setTimeout(() => {
      unmountTimer.current = undefined
      setMounted(false)
    }, UNMOUNT_DELAY)
  }

  return (
    <span ref={wrapRef} className={styles.infoWrap} data-settings-info onMouseEnter={show} onMouseLeave={hide}>
      <button
        type="button"
        className={styles.infoButton}
        aria-label={`${label}说明`}
        aria-describedby={tooltipId}
      >
        i
      </button>
      <span id={tooltipId} className={styles.infoTooltip} data-info-tooltip data-align={align} data-open={open} role="tooltip">
        {mounted ? <>{preview}<RevealText text={description} /></> : description}
      </span>
    </span>
  )
}
