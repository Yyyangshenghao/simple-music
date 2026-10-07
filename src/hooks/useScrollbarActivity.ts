import { useEffect } from 'react'

const HIDE_DELAY = 800

/** 捕获所有内层滚动，统一展示滚动条；不参与滚动位置或内容布局。 */
export function useScrollbarActivity() {
  useEffect(() => {
    const timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>()

    function onScroll(event: Event) {
      const el = event.target
      if (!(el instanceof HTMLElement)) return
      const timer = timers.get(el)
      if (timer !== undefined) clearTimeout(timer)
      else el.setAttribute('data-sm-scrolling', '')
      timers.set(el, setTimeout(() => {
        el.removeAttribute('data-sm-scrolling')
        timers.delete(el)
      }, HIDE_DELAY))
    }

    document.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('scroll', onScroll, true)
      for (const [el, timer] of timers) {
        clearTimeout(timer)
        el.removeAttribute('data-sm-scrolling')
      }
      timers.clear()
    }
  }, [])
}
