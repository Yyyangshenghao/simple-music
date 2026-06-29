// src/components/Layout/modules/useHoverPanel.ts
import { useRef, useCallback } from 'react'
import gsap from 'gsap'
import type { RefObject } from 'react'
import { ANIM } from '../../../lib/animation'

interface UseHoverPanelOptions {
  hideDelay?: number
}

interface HoverPanelResult {
  /** 绑定到图标种子的事件 props */
  triggerProps: {
    onMouseEnter: () => void
    onMouseLeave: () => void
  }
  /** 绑定到展开 panel 的事件 props */
  panelProps: {
    onMouseEnter: () => void
    onMouseLeave: () => void
  }
}

export function useHoverPanel(
  panelRef: RefObject<HTMLElement | null>,
  opts: UseHoverPanelOptions = {}
): HoverPanelResult {
  const hideDelay = opts.hideDelay ?? 150
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const visible = useRef(false)

  const showPanel = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
    if (visible.current || !panelRef.current) return
    visible.current = true
    gsap.killTweensOf(panelRef.current)
    gsap.fromTo(
      panelRef.current,
      { x: -16, opacity: 0, scale: 0.96, pointerEvents: 'none' },
      {
        x: 0,
        opacity: 1,
        scale: 1,
        pointerEvents: 'auto',
        duration: ANIM.DURATION_ENTER,
        ease: ANIM.EASE_ENTER,
      }
    )
  }, [panelRef])

  const scheduleHide = useCallback(() => {
    hideTimer.current = setTimeout(() => {
      if (!panelRef.current) return
      visible.current = false
      gsap.killTweensOf(panelRef.current)
      gsap.to(panelRef.current, {
        x: -10,
        opacity: 0,
        scale: 0.96,
        pointerEvents: 'none',
        duration: ANIM.DURATION_LEAVE,
        ease: ANIM.EASE_LEAVE,
      })
    }, hideDelay)
  }, [panelRef, hideDelay])

  const cancelHide = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
  }, [])

  return {
    triggerProps: {
      onMouseEnter: showPanel,
      onMouseLeave: scheduleHide,
    },
    panelProps: {
      onMouseEnter: cancelHide,
      onMouseLeave: scheduleHide,
    },
  }
}
