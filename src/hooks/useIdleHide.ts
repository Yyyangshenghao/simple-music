import { useEffect, useState } from 'react'

/**
 * 沉浸式空闲检测：enabled 期间监听全局鼠标/键盘活动，
 * 超过 timeoutMs 无操作返回 true（空闲），一有动作立即恢复 false。
 * enabled 为 false 时不监听且恒为 false。
 */
export function useIdleHide(enabled: boolean, timeoutMs = 3000): boolean {
  const [idle, setIdle] = useState(false)

  useEffect(() => {
    if (!enabled) {
      setIdle(false)
      return
    }
    let timer = 0
    const reset = () => {
      setIdle(false)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setIdle(true), timeoutMs)
    }
    reset()
    const events = ['mousemove', 'mousedown', 'keydown'] as const
    for (const ev of events) window.addEventListener(ev, reset)
    return () => {
      window.clearTimeout(timer)
      for (const ev of events) window.removeEventListener(ev, reset)
    }
  }, [enabled, timeoutMs])

  return idle
}
