import { createContext } from 'react'

export const ListScrollActivity = createContext(false)
export const LIST_SCROLL_IDLE_MS = 180
/** 滚动停止后再静置这么久，指针移动才恢复悬停；覆盖外接鼠标逐格拨动的间隙。 */
export const CARD_POINTER_RESUME_MS = 400

/**
 * 滚轮停顿不重启悬停动效；结束滚动后，主动指针或焦点操作才恢复。
 * 光标跟着卡片移动时，指针移动要等停稳后才生效，避免每格滚轮都恢复一次悬停又立刻暂停。
 */
export function observeCardScrollActivity(viewport: EventTarget, onChange: (paused: boolean) => void): () => void {
  let scrolling = false
  let paused = false
  let settled = true
  let pointerPending = false
  let settleTimer: ReturnType<typeof setTimeout> | undefined
  const clearSettle = () => {
    if (settleTimer !== undefined) clearTimeout(settleTimer)
    settleTimer = undefined
  }
  const resume = () => {
    if (scrolling || !paused) return
    clearSettle()
    pointerPending = false
    paused = false
    onChange(false)
  }
  const stop = observeListScrollActivity(viewport, (active) => {
    scrolling = active
    clearSettle()
    pointerPending = false
    settled = false
    if (active && !paused) {
      paused = true
      onChange(true)
    } else if (!active) {
      settleTimer = setTimeout(() => {
        settleTimer = undefined
        settled = true
        if (pointerPending) resume()
      }, CARD_POINTER_RESUME_MS)
    }
  }, { wheel: true })
  const onPointerMove = () => {
    if (scrolling || !paused) return
    if (settled) resume()
    else pointerPending = true
  }
  viewport.addEventListener('pointermove', onPointerMove, { passive: true })
  viewport.addEventListener('pointerdown', resume, { passive: true })
  viewport.addEventListener('focusin', resume)
  return () => {
    stop()
    clearSettle()
    viewport.removeEventListener('pointermove', onPointerMove)
    viewport.removeEventListener('pointerdown', resume)
    viewport.removeEventListener('focusin', resume)
  }
}

/** 连续滚动期间暂停行查询；只在开始和停止时通知，不逐帧更新 React 状态。 */
export function observeListScrollActivity(viewport: EventTarget, onChange: (scrolling: boolean) => void, options: { wheel?: boolean } = {}): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let scrolling = false
  const onScroll = () => {
    if (!scrolling) { scrolling = true; onChange(true) }
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      scrolling = false
      onChange(false)
    }, LIST_SCROLL_IDLE_MS)
  }
  // 同时捕获探索页内部横向轨道的惯性滚动。
  const capture = options.wheel === true
  viewport.addEventListener('scroll', onScroll, { passive: true, capture })
  // 探索页在第一次位移前暂停悬停；滚到边界没有 scroll 事件时也按时恢复。
  if (options.wheel) viewport.addEventListener('wheel', onScroll, { passive: true })
  return () => {
    viewport.removeEventListener('scroll', onScroll, { capture })
    if (options.wheel) viewport.removeEventListener('wheel', onScroll)
    if (timer !== undefined) clearTimeout(timer)
  }
}
