import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import styles from './HoverTips.module.css'

/** 首次悬停多久后出现；提示刚消失不久再移到相邻按钮则立即出现。 */
const SHOW_DELAY = 350
const WARM_WINDOW = 600
const EDGE_GAP = 8

interface Tip {
  text: string
  /** 相对父容器的按钮水平中心与顶部。 */
  x: number
  top: number
}

/**
 * 给父容器内的图标按钮统一显示悬停文字提示：读取 data-tip，没有时用 aria-label。
 * 放在父容器内即可（父容器需 position: relative）；exclude 内的按钮不提示，容器内有面板展开时也不提示。
 */
export function HoverTips({ exclude }: { exclude?: string }) {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<Tip | null>(null)
  const [shift, setShift] = useState(0)

  useEffect(() => {
    const host = anchorRef.current?.parentElement
    if (!host) return
    let showTimer: ReturnType<typeof setTimeout> | undefined
    let warmUntil = 0
    let current: HTMLElement | null = null
    let visible = false

    const hide = () => {
      clearTimeout(showTimer)
      if (current) warmUntil = Date.now() + WARM_WINDOW
      current = null
      visible = false
      setTip(null)
    }
    const show = (button: HTMLButtonElement) => {
      const text = button.dataset.tip || button.getAttribute('aria-label')
      if (!text) return
      const hostRect = host.getBoundingClientRect()
      const rect = button.getBoundingClientRect()
      visible = true
      setShift(0)
      setTip({ text, x: rect.left + rect.width / 2 - hostRect.left, top: rect.top - hostRect.top })
    }
    const handleOver = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return
      const button = (event.target as Element).closest?.('button') as HTMLButtonElement | null
      // 有面板展开时（队列、更多菜单等）整组不提示，也避免给面板内部的按钮加提示。
      const valid = button && host.contains(button) && !(exclude && button.closest(exclude))
        && !button.disabled && !host.querySelector('[aria-expanded="true"]')
      if (!valid) {
        if (current) hide()
        return
      }
      if (button === current) return
      clearTimeout(showTimer)
      current = button
      if (Date.now() < warmUntil || visible) show(button)
      else showTimer = setTimeout(() => current === button && show(button), SHOW_DELAY)
    }

    host.addEventListener('pointerover', handleOver)
    host.addEventListener('pointerleave', hide)
    host.addEventListener('pointerdown', hide)
    return () => {
      clearTimeout(showTimer)
      host.removeEventListener('pointerover', handleOver)
      host.removeEventListener('pointerleave', hide)
      host.removeEventListener('pointerdown', hide)
    }
  }, [exclude])

  // 靠窗口边缘时整体内收，不让提示被裁切。
  useLayoutEffect(() => {
    const node = tipRef.current
    if (!node || !tip) return
    const rect = node.getBoundingClientRect()
    const overflowRight = rect.right - (window.innerWidth - EDGE_GAP)
    const overflowLeft = EDGE_GAP - rect.left
    setShift(overflowRight > 0 ? -overflowRight : overflowLeft > 0 ? overflowLeft : 0)
  }, [tip])

  return (
    <>
      <span ref={anchorRef} hidden />
      {tip && (
        <div
          ref={tipRef}
          key={tip.text + tip.x}
          className={styles.tip}
          role="tooltip"
          style={{ left: tip.x, top: tip.top, translate: `calc(-50% + ${shift}px) calc(-100% - 8px)` }}
        >
          {tip.text}
        </div>
      )}
    </>
  )
}
