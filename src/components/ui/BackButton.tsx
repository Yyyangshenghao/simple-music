import { useEffect, useRef, useState } from 'react'
import styles from './BackButton.module.css'

interface BackButtonProps {
  onClick: () => void
  /** 悬停/聚焦时展开的文字 */
  label?: string
  ariaLabel?: string
  /** 页面自身的定位样式(外边距等) */
  className?: string
  /** 进入页面先露面，随后向左躲出视口；指针移到左上角或键盘聚焦时滑回。行内按钮组里应关闭。 */
  autoHide?: boolean
}

/** 进入后停留多久再躲起来，让用户先看到返回在哪。 */
const INTRO_MS = 1400
/** 指针离开后稍等再躲，避免擦边时来回闪。 */
const LEAVE_MS = 450

/** 各页面统一的返回按钮：沿用歌词页收起按钮的玻璃圆钮，悬停时向右展开文字。 */
export function BackButton({ onClick, label = '返回', ariaLabel, className, autoHide = true }: BackButtonProps) {
  const dockRef = useRef<HTMLSpanElement>(null)
  const [introDone, setIntroDone] = useState(!autoHide)
  const [hovering, setHovering] = useState(false)
  const [focused, setFocused] = useState(false)
  const leaveTimer = useRef<ReturnType<typeof setTimeout>>()
  const hidden = autoHide && introDone && !hovering && !focused

  useEffect(() => {
    if (!autoHide) return
    const timer = setTimeout(() => setIntroDone(true), INTRO_MS)
    return () => { clearTimeout(timer); clearTimeout(leaveTimer.current) }
  }, [autoHide])

  // 躲藏距离按当前位置量：整颗按钮移出视口左缘，而不是固定像素。
  useEffect(() => {
    const dock = dockRef.current
    if (hidden && dock) dock.style.setProperty('--back-hide-x', `${-Math.ceil(dock.getBoundingClientRect().right + 12)}px`)
  }, [hidden])

  const button = (
    <button
      type="button"
      className={`${styles.backBtn} no-drag${autoHide ? '' : className ? ` ${className}` : ''}`}
      onClick={onClick}
      aria-label={ariaLabel ?? label}
      title={label}
    >
      <span className={styles.icon}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </span>
      <span className={styles.label} aria-hidden="true"><span>{label}</span></span>
    </button>
  )
  if (!autoHide) return button

  return (
    <span
      ref={dockRef}
      className={`${styles.dock}${className ? ` ${className}` : ''}`}
      data-hidden={hidden}
      onPointerEnter={() => { clearTimeout(leaveTimer.current); setHovering(true) }}
      onPointerLeave={() => { leaveTimer.current = setTimeout(() => setHovering(false), LEAVE_MS) }}
      onFocus={event => setFocused(event.target.matches(':focus-visible'))}
      onBlur={() => setFocused(false)}
    >
      {button}
    </span>
  )
}
